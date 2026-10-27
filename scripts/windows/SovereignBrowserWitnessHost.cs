using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

public static class StephanosBrowserWitnessHost {
  const string Schema = "stephanos.browser-native-message.v1";
  const string ObservationSchema = "stephanos.sovereign-browser-observation.v1";
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 6000000, RecursionLimit = 12 };
  static readonly string DirectoryRoot = AppDomain.CurrentDomain.BaseDirectory;
  static readonly string ConfigPath = Path.Combine(DirectoryRoot, "allowed-origins.json");
  static readonly string ProofRoot = Path.Combine(DirectoryRoot, "receipts");
  static string Text(object value) { return value == null ? "" : Convert.ToString(value); }
  static string Value(IDictionary<string, object> map, string key) { object v; return map.TryGetValue(key, out v) ? Text(v) : ""; }
  static bool Flag(IDictionary<string, object> map, string key) { object v; return map.TryGetValue(key, out v) && v is bool && (bool)v; }
  static long Number(IDictionary<string, object> map, string key) {
    object v; long n;
    return map.TryGetValue(key, out v) && Int64.TryParse(Text(v), out n) && n >= 0 && n <= 100000 ? n : 0;
  }
  static IDictionary<string, object> Map(object o) { return o as IDictionary<string, object>; }
  static string Hash(byte[] data) {
    using (var s = SHA256.Create()) {
      var bytes = s.ComputeHash(data);
      return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
    }
  }
  static string ShaText(string s) { return Hash(Encoding.UTF8.GetBytes(s)); }
  static byte[] ReadExact(Stream input, int size) {
    var data = new byte[size]; int offset=0;
    while(offset<size) { int read=input.Read(data,offset,size-offset); if(read<=0) return null; offset+=read; }
    return data;
  }
  static void Respond(Stream output, object value) {
    byte[] data=Encoding.UTF8.GetBytes(Json.Serialize(value));
    byte[] prefix=BitConverter.GetBytes(data.Length);
    output.Write(prefix,0,prefix.Length); output.Write(data,0,data.Length); output.Flush();
  }
  static object Error(string code) {
    return new { schemaVersion=Schema, ok=false, blocker=code };
  }
  static bool IsValidOrigin(string candidate) {
    Uri u;
    if (!Uri.TryCreate(candidate,UriKind.Absolute,out u)) return false;
    if (u.Scheme!="http" && u.Scheme!="https") return false;
    if (u.UserInfo.Length>0 || !string.IsNullOrEmpty(u.Query) || !string.IsNullOrEmpty(u.Fragment)) return false;
    if (u.AbsolutePath!="/" || u.GetLeftPart(UriPartial.Authority)!=candidate) return false;
    if (u.Scheme=="http" && u.Host!="localhost" && u.Host!="127.0.0.1") return false;
    return true;
  }
  static List<string> Origins() {
    if (!File.Exists(ConfigPath)) return new List<string>();
    var raw=Json.DeserializeObject(File.ReadAllText(ConfigPath,Encoding.UTF8));
    var config=Map(raw); if(config==null) return new List<string>();
    object value; if(!config.TryGetValue("allowedOrigins",out value)) return new List<string>();
    var entries=value as IEnumerable; if(entries==null || value is string) return new List<string>();
    var list=new List<string>();
    foreach(var entry in entries) {
      var candidate=Text(entry);
      if(!IsValidOrigin(candidate)) continue;
      if(!list.Contains(candidate)) list.Add(candidate);
      if(list.Count>=16) break;
    }
    return list;
  }
  static object Handle(IDictionary<string,object> request) {
    if(request==null || Value(request,"schemaVersion")!=Schema) return Error("NATIVE_SCHEMA_INVALID");
    var action=Value(request,"action");
    if(action=="config") return new { schemaVersion=Schema, ok=true, allowedOrigins=Origins() };
    if(action!="record") return Error("NATIVE_ACTION_NOT_ALLOWED");
    var mode=Value(request,"mode");
    if(mode!="capture" && mode!="scan") return Error("NATIVE_MODE_INVALID");
    object data; if(!request.TryGetValue("snapshots",out data)) return Error("NATIVE_SNAPSHOTS_INVALID");
    var snapshots=data as IEnumerable;
    if(snapshots==null || data is string) return Error("NATIVE_SNAPSHOTS_INVALID");
    var origins=Origins();
    var observed=new List<object>();
    var screenshots=new List<object>();
    var pendingImages=new List<KeyValuePair<string,byte[]>>();
    int captured=0, total=0;
    var now=DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
    foreach(var element in snapshots) {
      total++; if(total>8) return Error("NATIVE_TOO_MANY_TABS");
      var row=Map(element); if(row==null) return Error("NATIVE_TAB_INVALID");
      var origin=Value(row,"origin");
      if(!origins.Contains(origin)) return Error("NATIVE_ORIGIN_NOT_ALLOWED");
      object metricsRaw;
      if(!row.TryGetValue("metrics",out metricsRaw)) return Error("NATIVE_METRICS_INVALID");
      var metrics=Map(metricsRaw); if(metrics==null) return Error("NATIVE_METRICS_INVALID");
      var screenshot=Value(row,"screenshot");
      if(screenshot.Length>0 && (mode!="capture" || !Flag(row,"active"))) return Error("NATIVE_SCREENSHOT_SCOPE_INVALID");
      var safeMetrics=new {
        readyState=Value(metrics,"readyState")=="complete" ? "complete" : "unknown",
        imageCount=Number(metrics,"imageCount"),
        brokenImages=Number(metrics,"brokenImages"),
        unloadedImages=Number(metrics,"unloadedImages"),
        linkCount=Number(metrics,"linkCount"),
        emptyLinks=Number(metrics,"emptyLinks"),
        genericSpotifyLinks=Number(metrics,"genericSpotifyLinks"),
        spotifyTrackLinks=Number(metrics,"spotifyTrackLinks"),
        spotifySearchLinks=Number(metrics,"spotifySearchLinks"),
        buttonCount=Number(metrics,"buttonCount"),
        disabledButtonCount=Number(metrics,"disabledButtonCount"),
        headingCount=Number(metrics,"headingCount"),
        iframeCount=Number(metrics,"iframeCount"),
        instrumentedFrameCount=Number(metrics,"instrumentedFrameCount"),
        frameCoverageFullyVerified=false
      };
      var imageHash="";
      if(screenshot.Length>0) {
        if(!screenshot.StartsWith("data:image/jpeg;base64,",StringComparison.Ordinal) || screenshot.Length>3900000)
          return Error("NATIVE_IMAGE_FORMAT_INVALID");
        byte[] image;
        try { image=Convert.FromBase64String(screenshot.Substring("data:image/jpeg;base64,".Length)); }
        catch { return Error("NATIVE_IMAGE_DATA_INVALID"); }
        if(image.Length<4 || image.Length>2800000 || image[0]!=0xff || image[1]!=0xd8) return Error("NATIVE_IMAGE_BYTES_INVALID");
        imageHash=Hash(image);
        var imageName=DateTime.UtcNow.ToString("yyyyMMddTHHmmssfff") + "-" + imageHash.Substring(0,16) + ".jpg";
        pendingImages.Add(new KeyValuePair<string,byte[]>(imageName,image));
        screenshots.Add(new { imageName=imageName,sha256=imageHash });
        captured++;
      }
      observed.Add(new { originHash=ShaText(origin).Substring(0,16), metrics=safeMetrics, screenshotSha256=imageHash });
    }
    if(observed.Count==0 || (mode=="capture" && captured!=1)) return Error("NATIVE_CAPTURE_INCOMPLETE");
    // Validate the complete request before retaining any screenshot. A later
    // invalid origin, extra screenshot or ninth tab must leave no partial proof.
    Directory.CreateDirectory(ProofRoot);
    foreach(var pending in pendingImages) File.WriteAllBytes(Path.Combine(ProofRoot,pending.Key),pending.Value);
    var sample=new {
      schemaVersion=ObservationSchema, observedAtUtc=now,
      mechanism="operator-permissioned-chromium-native-messaging",
      readOnly=true, observationOnly=true,
      servedHeadVerified=false, functionalAcceptanceVerified=false,
      connectedTabCount=total, admittedTabCount=total,
      observedTabCount=captured, diagnosticTabCount=observed.Count,
      screenshotCount=captured, scanOnly=mode=="scan", observations=observed,
      screenshots=screenshots
    };
    var unsigned=Json.Serialize(sample);
    var evidenceHash=ShaText(unsigned);
    var receiptName=DateTime.UtcNow.ToString("yyyyMMddTHHmmssfff") + "-" + evidenceHash.Substring(0,16) + ".json";
    var receipt=Json.Serialize(new { sample.schemaVersion,sample.observedAtUtc,sample.mechanism,
      sample.readOnly,sample.observationOnly,sample.servedHeadVerified,sample.functionalAcceptanceVerified,
      sample.connectedTabCount,sample.admittedTabCount,sample.observedTabCount,sample.diagnosticTabCount,
      sample.screenshotCount,sample.scanOnly,sample.observations,sample.screenshots,evidenceHash });
    File.WriteAllText(Path.Combine(ProofRoot,receiptName),receipt,new UTF8Encoding(false));
    return new { schemaVersion=Schema,ok=true,message=mode=="scan"?"Diagnostic scan saved locally":"Screenshot and diagnostics saved locally",observedTabCount=observed.Count,screenshotCount=captured,evidenceHash };
  }
  public static int Main(string[] args) {
    var input=Console.OpenStandardInput();
    var output=Console.OpenStandardOutput();
    for(int messages=0;messages<64;messages++) {
      byte[] prefix=ReadExact(input,4); if(prefix==null) break;
      int len=BitConverter.ToInt32(prefix,0);
      if(len<=0 || len>4200000) { Respond(output,Error("NATIVE_FRAME_TOO_LARGE")); break; }
      byte[] data=ReadExact(input,len); if(data==null) break;
      object reply;
      try { reply=Handle(Map(Json.DeserializeObject(Encoding.UTF8.GetString(data)))); }
      catch { reply=Error("NATIVE_HOST_PROCESSING_FAILED"); }
      Respond(output,reply);
    }
    return 0;
  }
}
