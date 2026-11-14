// Source-only independent assertion verifier for #1814. No entry point, task,
// enrollment ceremony, filesystem, journal, network, child process or installer.
// The future protected owner calls Verify with its own protected enrollment and
// observed UTC clock, then independently proves release eligibility and performs
// atomic one-use admission. Success here NEVER supplies either of those gates.
// Candidate canonicalization/challenge match battleBridgeMobileInstallationV1.
// Native enrollment deliberately requires canonical uncompressed P-256 SPKI.
namespace Stephanos.Sovereign {
  using System;
  using System.Collections.Generic;
  using System.Globalization;
  using System.Security.Cryptography;
  using System.Text;
  using System.Text.RegularExpressions;

  internal static class SovereignMobileInstallAssertionV1 {
    const string CandidateSchema="stephanos.battle-bridge-mobile-installation-candidate.v1";
    const string EnrollmentSchema="stephanos.battle-bridge-mobile-installation-enrollment.v1";
    const string Action="INSTALL_SOVEREIGN_FIXED_RUNTIME_V1";
    const long SafeInteger=9007199254740991L;
    static readonly UTF8Encoding Utf8=new UTF8Encoding(false,true);
    static readonly string[] CandidateKeys={"schemaVersion","repository","issueNumber","action","requestId","nonce",
      "machineHash","operatorSid","sourceHead","sourceTree","packageSha256","closureSha256","releaseProofSha256",
      "enrollmentGeneration","requestedAtUtc","expiresAtUtc"};
    static readonly string[] EnrollmentKeys={"schemaVersion","machineHash","operatorSid","generation","rpId","origin",
      "credentialId","publicKeySpki","userHandle","lastSignCount","revoked","receiptPublicKeySpki"};

    sealed class Refusal : Exception { internal Refusal(string reason) : base(reason) { } }
    static void Deny(string reason) { throw new Refusal(reason); }
    static bool Matches(string text,string pattern) {
      return text!=null && Regex.IsMatch(text,pattern,RegexOptions.CultureInvariant);
    }
    static string Text(Dictionary<string,object> row,string key) {
      object value; if(!row.TryGetValue(key,out value) || !(value is string)) Deny("FIELD_TYPE_INVALID");
      return (string)value;
    }
    static long Integer(Dictionary<string,object> row,string key,long minimum,long maximum) {
      object value; if(!row.TryGetValue(key,out value) || !(value is double)) Deny("FIELD_TYPE_INVALID");
      double number=(double)value;
      if(Double.IsNaN(number) || Double.IsInfinity(number) || number!=Math.Truncate(number) ||
         number<minimum || number>maximum) Deny("INTEGER_INVALID");
      return (long)number;
    }
    static bool Boolean(Dictionary<string,object> row,string key) {
      object value; if(!row.TryGetValue(key,out value) || !(value is bool)) Deny("FIELD_TYPE_INVALID");
      return (bool)value;
    }
    static Dictionary<string,object> Record(object value,string[] keys) {
      var row=value as Dictionary<string,object>;
      if(row==null || row.Count!=keys.Length) Deny("JSON_KEYS_INVALID");
      foreach(string key in keys) if(!row.ContainsKey(key)) Deny("JSON_KEYS_INVALID");
      return row;
    }
    static DateTime Instant(string text) {
      DateTime result=DateTime.MinValue;
      if(text==null || text.Length!=24 || !DateTime.TryParseExact(text,"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
          CultureInfo.InvariantCulture,DateTimeStyles.AssumeUniversal|DateTimeStyles.AdjustToUniversal,out result) ||
          result.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture)!=text) Deny("TIME_INVALID");
      return result;
    }
    static byte[] Hash(byte[] data) { using(var sha=SHA256.Create()) return sha.ComputeHash(data); }
    static string Hex(byte[] data) { return BitConverter.ToString(data).Replace("-","").ToLowerInvariant(); }
    static string Url64(byte[] data) { return Convert.ToBase64String(data).TrimEnd('=').Replace('+','-').Replace('/','_'); }
    static byte[] Bytes(string text,int minimum,int maximum) {
      if(text==null || text.Length>(maximum*4+2)/3 || !Matches(text,"\\A[A-Za-z0-9_-]+\\z")) Deny("BASE64URL_INVALID");
      byte[] data;
      try { string b=text.Replace('-','+').Replace('_','/'); data=Convert.FromBase64String(b+new string('=',(4-b.Length%4)%4)); }
      catch(FormatException) { Deny("BASE64URL_INVALID"); return null; }
      if(data.Length<minimum || data.Length>maximum || Url64(data)!=text) Deny("BASE64URL_INVALID");
      return data;
    }
    static bool Equal(byte[] left,byte[] right) {
      if(left.Length!=right.Length) return false;
      int different=0; for(int i=0;i<left.Length;i++) different|=left[i]^right[i]; return different==0;
    }
    static byte[] Join(byte[] left,byte[] right) {
      var result=new byte[left.Length+right.Length]; Buffer.BlockCopy(left,0,result,0,left.Length);
      Buffer.BlockCopy(right,0,result,left.Length,right.Length); return result;
    }
    static CngKey PublicKey(string encoded) {
      byte[] spki=Bytes(encoded,91,91);
      // id-ecPublicKey + prime256v1 + zero-unused-bit uncompressed point.
      byte[] prefix={0x30,0x59,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,
        0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x03,0x42,0x00,0x04};
      for(int i=0;i<prefix.Length;i++) if(spki[i]!=prefix[i]) Deny("PUBLIC_KEY_INVALID");
      byte[] blob=new byte[72]; blob[0]=0x45;blob[1]=0x43;blob[2]=0x53;blob[3]=0x31;blob[4]=32;
      Buffer.BlockCopy(spki,27,blob,8,64);
      return CngKey.Import(blob,CngKeyBlobFormat.EccPublicBlob);
    }
    // Non-authoritative canonical public-key parser reused by the qualified
    // enrollment verifier. The caller owns/disposes the returned public key.
    internal static CngKey ReadP256PublicKeyV1(string spki) {return PublicKey(spki);}
    // Data-only strict reader. Closed key sets and semantic authority remain
    // with the typed caller; this rejects duplicates, arrays and malformed UTF8.
    internal static Dictionary<string,object> ReadBoundedObjectV1(string raw,int maximumBytes) {
      try {
        if(maximumBytes<1 || maximumBytes>16384)throw new InvalidOperationException();
        var value=new Json(raw,maximumBytes).Read() as Dictionary<string,object>;
        if(value==null)throw new InvalidOperationException();return value;
      }catch{throw new InvalidOperationException("MOBILE_BOUNDED_OBJECT_UNPROVEN");}
    }
    static byte[] DerSignature(string encoded) {
      byte[] der=Bytes(encoded,8,72);
      if(der[0]!=0x30 || der[1]!=der.Length-2) Deny("SIGNATURE_ENCODING_INVALID");
      var raw=new byte[64]; int at=2;
      for(int part=0;part<2;part++) {
        if(at+2>der.Length || der[at++]!=2) Deny("SIGNATURE_ENCODING_INVALID");
        int length=der[at++],start=at; at+=length;
        if(length<1 || length>33 || at>der.Length || (der[start]&0x80)!=0 ||
           (length>1 && der[start]==0 && (der[start+1]&0x80)==0) || (length==33 && der[start]!=0))
          Deny("SIGNATURE_ENCODING_INVALID");
        int significant=length-(der[start]==0 && length>1?1:0);
        if(significant>32) Deny("SIGNATURE_ENCODING_INVALID");
        Buffer.BlockCopy(der,at-significant,raw,part*32+32-significant,significant);
      }
      if(at!=der.Length) Deny("SIGNATURE_ENCODING_INVALID"); return raw;
    }
    static string CanonicalCandidate(Dictionary<string,object> candidate) {
      // Every candidate string has first been restricted to an ASCII grammar
      // without escaping characters. Numeric fields are safe positive integers.
      var text=new StringBuilder("{");
      foreach(string key in CandidateKeys) {
        if(text.Length>1) text.Append(','); text.Append('"').Append(key).Append("\":");
        if(key=="issueNumber" || key=="enrollmentGeneration")
          text.Append(((long)(double)candidate[key]).ToString(CultureInfo.InvariantCulture));
        else text.Append('"').Append((string)candidate[key]).Append('"');
      }
      return text.Append('}').ToString();
    }
    static void CandidatePolicy(Dictionary<string,object> candidate) {
      if(Text(candidate,"schemaVersion")!=CandidateSchema || Text(candidate,"repository")!="Cheekyfellastef/stephan-os" ||
         Integer(candidate,"issueNumber",1814,1814)!=1814 || Text(candidate,"action")!=Action ||
         !Matches(Text(candidate,"requestId"),"\\Amobile-install-[a-z0-9][a-z0-9-]{7,63}\\z") ||
         !Matches(Text(candidate,"operatorSid"),"\\AS-1-5-21-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}\\z")) Deny("CANDIDATE_INVALID");
      Integer(candidate,"enrollmentGeneration",1,SafeInteger);
      foreach(string key in new[]{"sourceHead","sourceTree"})
        if(!Matches(Text(candidate,key),"\\A[a-f0-9]{40}\\z")) Deny("CANDIDATE_INVALID");
      foreach(string key in new[]{"nonce","machineHash","packageSha256","closureSha256","releaseProofSha256"})
        if(!Matches(Text(candidate,key),"\\A[a-f0-9]{64}\\z")) Deny("CANDIDATE_INVALID");
      DateTime issued=Instant(Text(candidate,"requestedAtUtc")),expires=Instant(Text(candidate,"expiresAtUtc"));
      if(expires<=issued || (expires-issued).TotalMilliseconds>300000) Deny("CANDIDATE_WINDOW_INVALID");
    }
    static void Candidate(Dictionary<string,object> candidate,DateTime now) {
      CandidatePolicy(candidate);
      if(Instant(Text(candidate,"requestedAtUtc"))>now || Instant(Text(candidate,"expiresAtUtc"))<=now) Deny("CANDIDATE_NOT_FRESH");
    }
    // Historical terminal receipts still bind the original candidate after its
    // approval window expires. Parsing metadata never renews that approval.
    internal static MobileInstallCandidateBindingV1 ReadCandidateBindingV1(string candidateJson) {
      return MobileInstallCandidateBindingV1.Read(candidateJson);
    }
    internal sealed class MobileInstallCandidateBindingV1 {
      internal readonly string RequestId,Nonce,CandidateSha256,MachineHash,OperatorSid,SourceHead,SourceTree;
      internal readonly string PackageSha256,ClosureSha256,ReleaseProofSha256,CanonicalJson,Challenge;
      internal readonly long EnrollmentGeneration;
      internal readonly DateTime RequestedAtUtc,ExpiresAtUtc;
      readonly string integritySnapshot;
      private MobileInstallCandidateBindingV1(Dictionary<string,object> candidate) {
        RequestId=Text(candidate,"requestId");Nonce=Text(candidate,"nonce");MachineHash=Text(candidate,"machineHash");OperatorSid=Text(candidate,"operatorSid");
        SourceHead=Text(candidate,"sourceHead");SourceTree=Text(candidate,"sourceTree");PackageSha256=Text(candidate,"packageSha256");
        ClosureSha256=Text(candidate,"closureSha256");ReleaseProofSha256=Text(candidate,"releaseProofSha256");
        EnrollmentGeneration=Integer(candidate,"enrollmentGeneration",1,SafeInteger);
        RequestedAtUtc=Instant(Text(candidate,"requestedAtUtc"));ExpiresAtUtc=Instant(Text(candidate,"expiresAtUtc"));
        CanonicalJson=CanonicalCandidate(candidate);CandidateSha256=Hex(Hash(Utf8.GetBytes(CanonicalJson)));
        Challenge=Url64(Hash(Utf8.GetBytes("stephanos.mobile-installation-approval.v1\0"+CandidateSha256)));integritySnapshot=Snapshot();
      }
      string Snapshot() {
        return RequestId+"|"+Nonce+"|"+CandidateSha256+"|"+MachineHash+"|"+OperatorSid+"|"+SourceHead+"|"+SourceTree+"|"+PackageSha256+"|"+
          ClosureSha256+"|"+ReleaseProofSha256+"|"+CanonicalJson+"|"+Challenge+"|"+EnrollmentGeneration.ToString(CultureInfo.InvariantCulture)+"|"+
          RequestedAtUtc.Ticks.ToString(CultureInfo.InvariantCulture)+"|"+ExpiresAtUtc.Ticks.ToString(CultureInfo.InvariantCulture);
      }
      internal bool IsIntact() {try{return String.Equals(integritySnapshot,Snapshot(),StringComparison.Ordinal);}catch{return false;}}
      internal static MobileInstallCandidateBindingV1 Read(string raw) {
        try {var candidate=Record(new Json(raw,4096).Read(),CandidateKeys);CandidatePolicy(candidate);return new MobileInstallCandidateBindingV1(candidate);}
        catch {throw new InvalidOperationException("MOBILE_CANDIDATE_BINDING_UNPROVEN");}
      }
    }
    static void EnrollmentPolicy(Dictionary<string,object> enrolled) {
      if(Text(enrolled,"schemaVersion")!=EnrollmentSchema || Boolean(enrolled,"revoked") ||
         !Matches(Text(enrolled,"machineHash"),"\\A[a-f0-9]{64}\\z") ||
         !Matches(Text(enrolled,"operatorSid"),"\\AS-1-5-21-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}\\z")) Deny("ENROLLMENT_INVALID");
      Integer(enrolled,"generation",1,SafeInteger); Integer(enrolled,"lastSignCount",0,UInt32.MaxValue);
      string rp=Text(enrolled,"rpId"),origin=Text(enrolled,"origin");
      if(rp.Length>253 || !Matches(rp,"\\A(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}\\z") || origin.Length>1024)
        Deny("ENROLLMENT_ORIGIN_INVALID");
      Match match=Regex.Match(origin,"\\Ahttps://([a-z0-9.-]+)(?::([0-9]{1,5}))?\\z",RegexOptions.CultureInvariant);
      if(!match.Success) Deny("ENROLLMENT_ORIGIN_INVALID");
      string host=match.Groups[1].Value;
      if(host!=rp && !host.EndsWith("."+rp,StringComparison.Ordinal)) Deny("ENROLLMENT_ORIGIN_INVALID");
      if(match.Groups[2].Success) {
        int port=Int32.Parse(match.Groups[2].Value,CultureInfo.InvariantCulture);
        if(port>65535 || port==443 || port.ToString(CultureInfo.InvariantCulture)!=match.Groups[2].Value) Deny("ENROLLMENT_ORIGIN_INVALID");
      }
      Uri uri; if(!Uri.TryCreate(origin,UriKind.Absolute,out uri) || uri.GetLeftPart(UriPartial.Authority)!=origin) Deny("ENROLLMENT_ORIGIN_INVALID");
      Bytes(Text(enrolled,"credentialId"),16,1024);Bytes(Text(enrolled,"userHandle"),1,64);
      using(var device=PublicKey(Text(enrolled,"publicKeySpki"))) { }
      using(var receipt=PublicKey(Text(enrolled,"receiptPublicKeySpki"))) { }
    }
    static void Enrollment(Dictionary<string,object> enrolled,Dictionary<string,object> candidate) {
      EnrollmentPolicy(enrolled);
      if(Text(enrolled,"machineHash")!=Text(candidate,"machineHash") || Text(enrolled,"operatorSid")!=Text(candidate,"operatorSid") ||
         Integer(enrolled,"generation",1,SafeInteger)!=Integer(candidate,"enrollmentGeneration",1,SafeInteger)) Deny("ENROLLMENT_BINDING_MISMATCH");
    }
    static string CredentialBinding(Dictionary<string,object> enrolled) {
      var value=new StringBuilder("stephanos.mobile-install-credential-binding.v1\0");
      foreach(string key in new[]{"machineHash","operatorSid","rpId","origin","credentialId","publicKeySpki","userHandle","receiptPublicKeySpki"})
        value.Append(Text(enrolled,key)).Append('\0');
      value.Append(Integer(enrolled,"generation",1,SafeInteger).ToString(CultureInfo.InvariantCulture));
      return Hex(Hash(Utf8.GetBytes(value.ToString())));
    }
    // Metadata validation only. The protected owner must retain the actual
    // protected source handle and independently match the observed machine/SID.
    // This parser supplies no enrollment, release or execution authority.
    internal static MobileInstallEnrollmentBindingV1 ReadEnrollmentBindingV1(string enrollmentJson) {
      return MobileInstallEnrollmentBindingV1.Read(enrollmentJson);
    }
    internal sealed class MobileInstallEnrollmentBindingV1 {
      internal readonly string MachineHash,OperatorSid,CredentialBindingSha256,ReceiptPublicKeySpki;
      internal readonly long Generation;
      internal readonly uint LastSignCount;
      private MobileInstallEnrollmentBindingV1(Dictionary<string,object> enrolled) {
        MachineHash=Text(enrolled,"machineHash");OperatorSid=Text(enrolled,"operatorSid");
        Generation=Integer(enrolled,"generation",1,SafeInteger);LastSignCount=(uint)Integer(enrolled,"lastSignCount",0,UInt32.MaxValue);
        CredentialBindingSha256=CredentialBinding(enrolled);ReceiptPublicKeySpki=Text(enrolled,"receiptPublicKeySpki");
      }
      internal static MobileInstallEnrollmentBindingV1 Read(string raw) {
        try {
          var enrolled=Record(new Json(raw,8192).Read(),EnrollmentKeys);EnrollmentPolicy(enrolled);
          return new MobileInstallEnrollmentBindingV1(enrolled);
        } catch {throw new InvalidOperationException("MOBILE_ENROLLMENT_BINDING_UNPROVEN");}
      }
    }

    internal static MobileInstallAssertionResultV1 Verify(string candidateJson,string enrollmentJson,string assertionJson,DateTime nowUtc) {
      return MobileInstallAssertionResultV1.Verify(candidateJson,enrollmentJson,assertionJson,nowUtc);
    }
    static uint VerifyAssertionCore(Dictionary<string,object> enrolled,string assertionJson,string challenge) {
      var assertion=Record(new Json(assertionJson,16384).Read(),new[]{"type","id","rawId","response"});
      var response=Record(assertion["response"],new[]{"clientDataJSON","authenticatorData","signature","userHandle"});
      object handle=response["userHandle"];
      if(Text(assertion,"type")!="public-key" || Text(assertion,"id")!=Text(enrolled,"credentialId") ||
         Text(assertion,"rawId")!=Text(enrolled,"credentialId") || (handle!=null && (!(handle is string) || (string)handle!=Text(enrolled,"userHandle"))))
        Deny("CREDENTIAL_MISMATCH");
      byte[] clientBytes=Bytes(Text(response,"clientDataJSON"),32,4096);
      var client=new Json(Utf8.GetString(clientBytes),4096).Read() as Dictionary<string,object>;
      if(client==null || (client.Count!=3 && client.Count!=4) || !client.ContainsKey("type") || !client.ContainsKey("challenge") ||
         !client.ContainsKey("origin") || (client.Count==4 && !client.ContainsKey("crossOrigin")))Deny("CLIENT_KEYS_INVALID");
      if(Text(client,"type")!="webauthn.get" || Text(client,"origin")!=Text(enrolled,"origin") || Text(client,"challenge")!=challenge ||
         (client.ContainsKey("crossOrigin") && Boolean(client,"crossOrigin")))Deny("CLIENT_BINDING_MISMATCH");
      byte[] auth=Bytes(Text(response,"authenticatorData"),37,37),rpHash=Hash(Utf8.GetBytes(Text(enrolled,"rpId")));
      var actualRp=new byte[32];Buffer.BlockCopy(auth,0,actualRp,0,32);int flags=auth[32];
      if(!Equal(actualRp,rpHash) || (flags&5)!=5 || (flags&0xe2)!=0 || ((flags&0x10)!=0 && (flags&8)==0))Deny("AUTHENTICATOR_POLICY_REFUSED");
      uint count=((uint)auth[33]<<24)|((uint)auth[34]<<16)|((uint)auth[35]<<8)|auth[36];
      long previous=Integer(enrolled,"lastSignCount",0,UInt32.MaxValue);
      if((previous!=0 || count!=0) && count<=previous)Deny("SIGN_COUNTER_ROLLBACK");
      using(var key=PublicKey(Text(enrolled,"publicKeySpki")))using(var ecdsa=new ECDsaCng(key))
        if(!ecdsa.VerifyHash(Hash(Join(auth,Hash(clientBytes))),DerSignature(Text(response,"signature"))))Deny("SIGNATURE_INVALID");
      return count;
    }
    internal static string EnrollmentChallengeV1(string canonicalSetupDescriptor) {
      if(String.IsNullOrEmpty(canonicalSetupDescriptor) || canonicalSetupDescriptor.Length>8192 || Utf8.GetByteCount(canonicalSetupDescriptor)>8192)
        throw new InvalidOperationException("MOBILE_ENROLLMENT_DESCRIPTOR_BOUND");
      return Url64(Hash(Utf8.GetBytes("stephanos.mobile-install-enrollment-proof.v1\0"+canonicalSetupDescriptor)));
    }
    // This is device-possession proof for trusted INITIAL SETUP, not install
    // approval. The setup owner separately authenticates descriptor semantics,
    // actual operator/machine, expiry and single-use setup. Runtime has no ENROLL.
    internal static MobileInstallEnrollmentProofV1 VerifyEnrollmentProofV1(string enrollmentJson,string assertionJson,string canonicalSetupDescriptor,DateTime nowUtc) {
      return MobileInstallEnrollmentProofV1.Verify(enrollmentJson,assertionJson,canonicalSetupDescriptor,nowUtc);
    }
    internal sealed class MobileInstallEnrollmentProofV1 {
      internal readonly bool DevicePossessionVerified,InstallationApprovalGranted=false,ExecutionAuthorityGranted=false,ReleaseEligibilityVerified=false;
      internal readonly string ReasonCode,CredentialBindingSha256,SetupDescriptorSha256;
      internal readonly uint SignCount;
      internal readonly long EnrollmentGeneration;
      private MobileInstallEnrollmentProofV1(bool verified,string reason,string credential,string descriptor,uint count,long generation) {
        DevicePossessionVerified=verified;ReasonCode=reason;CredentialBindingSha256=credential;SetupDescriptorSha256=descriptor;SignCount=count;EnrollmentGeneration=generation;
      }
      internal static MobileInstallEnrollmentProofV1 Verify(string enrollmentJson,string assertionJson,string descriptor,DateTime nowUtc) {
        try {
          if(nowUtc.Kind!=DateTimeKind.Utc)Deny("UTC_CLOCK_REQUIRED");
          var enrolled=Record(new Json(enrollmentJson,8192).Read(),EnrollmentKeys);EnrollmentPolicy(enrolled);
          uint count=VerifyAssertionCore(enrolled,assertionJson,EnrollmentChallengeV1(descriptor));
          return new MobileInstallEnrollmentProofV1(true,"MOBILE_ENROLLMENT_DEVICE_POSSESSION_VERIFIED",CredentialBinding(enrolled),Hex(Hash(Utf8.GetBytes(descriptor))),
            count,Integer(enrolled,"generation",1,SafeInteger));
        }catch(Refusal error){return new MobileInstallEnrollmentProofV1(false,error.Message,null,null,0,0);}
        catch{return new MobileInstallEnrollmentProofV1(false,"MOBILE_ENROLLMENT_PROOF_UNPROVEN",null,null,0,0);}
      }
    }
    internal sealed class MobileInstallAssertionResultV1 {
      internal readonly bool ApprovalVerified, ExecutionAuthorityGranted, ReleaseEligibilityVerified;
      internal readonly string ReasonCode, RequestId, CandidateSha256, CredentialBindingSha256;
      internal readonly long EnrollmentGeneration;
      internal readonly DateTime ExpiresAtUtc;
      internal readonly uint SignCount;
      readonly string integritySnapshot;
      private MobileInstallAssertionResultV1(bool verified,string reason,string request,string digest,uint count,
          long generation=0,string credential=null,DateTime expires=default(DateTime)) {
        ApprovalVerified=verified; ReasonCode=reason; RequestId=request; CandidateSha256=digest; SignCount=count;
        EnrollmentGeneration=generation;CredentialBindingSha256=credential;ExpiresAtUtc=expires;
        ExecutionAuthorityGranted=false; ReleaseEligibilityVerified=false;integritySnapshot=Snapshot();
      }
      string Snapshot() {
        string text="stephanos.mobile-assertion-live-result.v1\0"+ApprovalVerified+"\0"+ExecutionAuthorityGranted+"\0"+
          ReleaseEligibilityVerified+"\0"+ReasonCode+"\0"+RequestId+"\0"+CandidateSha256+"\0"+
          SignCount.ToString(CultureInfo.InvariantCulture)+"\0"+EnrollmentGeneration.ToString(CultureInfo.InvariantCulture)+"\0"+
          CredentialBindingSha256+"\0"+ExpiresAtUtc.Ticks.ToString(CultureInfo.InvariantCulture);
        return text;
      }
      // Immutable live-object consistency only, not an authentication boundary
      // against reflection-capable code already inside the trusted process.
      internal bool IsIntact() { try {return String.Equals(integritySnapshot,Snapshot(),StringComparison.Ordinal);}catch{return false;} }
    // Inputs are bounded UTF-8-compatible JSON, never paths or trust discovery.
    // The returned digest/count bind a future protected journal; they are not a
    // reusable approval object and do not persist counters or consume a nonce.
    internal static MobileInstallAssertionResultV1 Verify(string candidateJson,string enrollmentJson,string assertionJson,DateTime nowUtc) {
      try {
        if(nowUtc.Kind!=DateTimeKind.Utc) Deny("UTC_CLOCK_REQUIRED");
        var candidate=Record(new Json(candidateJson,4096).Read(),CandidateKeys);Candidate(candidate,nowUtc);
        var enrolled=Record(new Json(enrollmentJson,8192).Read(),EnrollmentKeys);Enrollment(enrolled,candidate);
        string digest=Hex(Hash(Utf8.GetBytes(CanonicalCandidate(candidate))));
        string challenge=Url64(Hash(Utf8.GetBytes("stephanos.mobile-installation-approval.v1\0"+digest)));
        uint count=VerifyAssertionCore(enrolled,assertionJson,challenge);
        return new MobileInstallAssertionResultV1(true,"ASSERTION_VERIFIED_REQUIRES_PROTECTED_ADMISSION",Text(candidate,"requestId"),digest,count,
          Integer(enrolled,"generation",1,SafeInteger),CredentialBinding(enrolled),Instant(Text(candidate,"expiresAtUtc")));
      } catch(Refusal error) {
        // Typed failures are local constants, never exception/path/input text.
        return new MobileInstallAssertionResultV1(false,error.Message,null,null,0);
      } catch(Exception) {
        return new MobileInstallAssertionResultV1(false,"ASSERTION_INVALID",null,null,0);
      }
    }
    }

    // Small bounded parser: reject duplicate keys at every nesting level before
    // deserialization can discard them. Arrays are not part of this protocol.
    sealed class Json {
      readonly string text;int at;
      internal Json(string input,int limit) {
        if(input==null || input.Length>limit || Utf8.GetByteCount(input)>limit) Deny("JSON_BOUND");text=input;
      }
      internal object Read() { object value=Value(0);Space();if(at!=text.Length) Deny("JSON_TRAILING");return value; }
      void Space() { while(at<text.Length && (text[at]==' ' || text[at]=='\t' || text[at]=='\r' || text[at]=='\n')) at++; }
      object Value(int depth) {
        Space();if(depth>4 || at>=text.Length) Deny("JSON_INVALID");char c=text[at];
        if(c=='{') {
          at++;Space();var row=new Dictionary<string,object>(StringComparer.Ordinal);
          if(at<text.Length && text[at]=='}') {at++;return row;}
          while(true) {
            Space();string key=String();if(row.ContainsKey(key) || row.Count>=20) Deny("JSON_DUPLICATE_OR_BOUND");
            Space();if(at>=text.Length || text[at++]!=':') Deny("JSON_INVALID");row.Add(key,Value(depth+1));Space();
            if(at<text.Length && text[at]=='}') {at++;return row;}
            if(at>=text.Length || text[at++]!=',') Deny("JSON_INVALID");
          }
        }
        if(c=='"') return String();
        if(Take("true")) return true;if(Take("false")) return false;if(Take("null")) return null;
        int start=at;
        if(at<text.Length && text[at]=='-') at++;
        if(at>=text.Length || text[at]<'0' || text[at]>'9') Deny("JSON_INVALID");
        if(text[at]=='0') at++;else while(at<text.Length && text[at]>='0' && text[at]<='9') at++;
        if(at<text.Length && text[at]=='.') {at++;Digits();}
        if(at<text.Length && (text[at]=='e' || text[at]=='E')) {at++;if(at<text.Length && (text[at]=='+' || text[at]=='-')) at++;Digits();}
        double number;if(!Double.TryParse(text.Substring(start,at-start),NumberStyles.Float,CultureInfo.InvariantCulture,out number) ||
          Double.IsInfinity(number) || Double.IsNaN(number)) Deny("JSON_NUMBER_INVALID");return number;
      }
      void Digits() { int start=at;while(at<text.Length && text[at]>='0' && text[at]<='9') at++;if(at==start) Deny("JSON_INVALID"); }
      bool Take(string token) {
        if(at+token.Length>text.Length || System.String.CompareOrdinal(text,at,token,0,token.Length)!=0) return false;
        at+=token.Length;return true;
      }
      string String() {
        if(at>=text.Length || text[at++]!='"') Deny("JSON_INVALID");var result=new StringBuilder();
        while(at<text.Length) {
          char c=text[at++];if(c=='"') {string value=result.ToString();Utf8.GetByteCount(value);return value;}
          if(c<32) Deny("JSON_INVALID");
          if(c=='\\') {
            if(at>=text.Length) Deny("JSON_INVALID");c=text[at++];
            switch(c) {
              case '"':case '\\':case '/':break;case 'b':c='\b';break;case 'f':c='\f';break;
              case 'n':c='\n';break;case 'r':c='\r';break;case 't':c='\t';break;
              case 'u':
                if(at+4>text.Length || !Matches(text.Substring(at,4),"\\A[0-9a-fA-F]{4}\\z")) Deny("JSON_INVALID");
                c=(char)Int32.Parse(text.Substring(at,4),NumberStyles.HexNumber,CultureInfo.InvariantCulture);at+=4;break;
              default:Deny("JSON_INVALID");break;
            }
          }
          result.Append(c);
        }
        Deny("JSON_INVALID");return null;
      }
    }
  }
}
