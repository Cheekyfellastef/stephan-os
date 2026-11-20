import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readMobileInstallerNativeSourceV1 } from './fixtures/sovereign-mobile-installer-native-source-v1.mjs';

// Only private synthetic log snapshots and UNNAMED ephemeral CNG keys are used.
// This fixture never calls OpenProtected, production EventLog or key enrollment.
const runner = String.raw`
namespace Stephanos.Sovereign {
  public static class MobileAnchorFixtureRunnerV1 {
    const string Machine="2222222222222222222222222222222222222222222222222222222222222222";
    const string Credential="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const string Initial="7777777777777777777777777777777777777777777777777777777777777777";
    const string Next="8888888888888888888888888888888888888888888888888888888888888888";
    const string Later="9999999999999999999999999999999999999999999999999999999999999999";
    const string Sid="S-1-5-21-1-2-3-1001";
    const System.Reflection.BindingFlags Hidden=System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.Instance;
    sealed class Pins : System.IDisposable {public bool Disposed;public void Dispose(){Disposed=true;}}
    sealed class Fixture : System.IDisposable {
      internal readonly System.Collections.Generic.List<MobileInstallAnchorEventV1> Events=new System.Collections.Generic.List<MobileInstallAnchorEventV1>();
      internal readonly System.Security.Cryptography.CngKey Key;
      internal readonly SovereignMobileInstallAnchorV1 Anchor;
      internal int Appends;
      internal System.Action<string> AppendOverride;
      internal Fixture(bool genesis=true,uint minimumSignCount=0) {
        Key=System.Security.Cryptography.CngKey.Create(System.Security.Cryptography.CngAlgorithm.ECDsaP256);
        if(!Key.IsEphemeral) throw new System.Exception("FIXTURE_KEY_NOT_EPHEMERAL");
        string spki=(string)typeof(SovereignMobileInstallAnchorV1).GetMethod("PublicSpki",Hidden).Invoke(null,new object[]{Key});
        var ctor=typeof(SovereignMobileInstallAnchorV1).GetConstructors(Hidden)[0];
        Anchor=(SovereignMobileInstallAnchorV1)ctor.Invoke(new object[]{Machine,Sid,1L,minimumSignCount,Credential,spki,Key,new Pins(),
          new System.Func<System.Collections.Generic.List<MobileInstallAnchorEventV1>>(()=>new System.Collections.Generic.List<MobileInstallAnchorEventV1>(Events)),
          new System.Action<string>(text=>{Appends++;if(AppendOverride!=null)AppendOverride(text);else Events.Add(new MobileInstallAnchorEventV1(2+Events.Count,text));})});
        if(genesis) Events.Add(new MobileInstallAnchorEventV1(2,Sign(0,Initial,new string('0',64))));
      }
      internal string Sign(long sequence,string hash,string previous) {
        return (string)typeof(SovereignMobileInstallAnchorV1).GetMethod("SignEntry",Hidden).Invoke(Anchor,new object[]{sequence,hash,previous});
      }
      public void Dispose(){Anchor.Dispose();}
    }
    static string Head(long sequence,string hash) {
      return "STEPHANOS-MOBILE-JOURNAL-HEAD-V1|"+Credential+"|1|"+sequence.ToString(System.Globalization.CultureInfo.InvariantCulture)+"|"+hash;
    }
    static void Check(bool yes,string reason){if(!yes)throw new System.Exception(reason);}
    static void Held(System.Action action) {
      try{action();}catch(System.Exception error){
        while(error is System.Reflection.TargetInvocationException && error.InnerException!=null)error=error.InnerException;
        if(error is System.InvalidOperationException && error.Message.StartsWith("MOBILE_ANCHOR_",System.StringComparison.Ordinal))return;
        throw;
      }
      throw new System.Exception("UNEXPECTED_ANCHOR_ACCEPTANCE");
    }
    static string Digest(string text) {
      using(var sha=System.Security.Cryptography.SHA256.Create())return System.BitConverter.ToString(sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(text))).Replace("-","").ToLowerInvariant();
    }
    static string SignRaw(System.Security.Cryptography.CngKey key,string body,string domain="stephanos.mobile-install-native-anchor.v1\0") {
      byte[] hash;
      using(var sha=System.Security.Cryptography.SHA256.Create())hash=sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(domain+body));
      using(var signer=new System.Security.Cryptography.ECDsaCng(key))return body+"|"+System.Convert.ToBase64String(signer.SignHash(hash)).TrimEnd('=').Replace('+','-').Replace('/','_');
    }
    static byte[] Sddl(string sddl) {
      var acl=new System.Security.AccessControl.RawSecurityDescriptor(sddl);var bytes=new byte[acl.BinaryLength];acl.GetBinaryForm(bytes,0);return bytes;
    }
    static System.Collections.Generic.Dictionary<string,object> Enrollment(Fixture fixture) {
      string spki=(string)typeof(SovereignMobileInstallAnchorV1).GetMethod("PublicSpki",Hidden).Invoke(null,new object[]{fixture.Key});
      return new System.Collections.Generic.Dictionary<string,object> {
        {"schemaVersion","stephanos.battle-bridge-mobile-installation-enrollment.v1"},{"machineHash",Machine},{"operatorSid",Sid},
        {"generation",1},{"rpId","stephanos.example"},{"origin","https://bridge.stephanos.example"},
        {"credentialId","BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH"},{"publicKeySpki",spki},{"userHandle","b3BlcmF0b3I"},
        {"lastSignCount",31},{"revoked",false},{"receiptPublicKeySpki",spki}};
    }
    static string Json(System.Collections.Generic.Dictionary<string,object> value) {
      return new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(value);
    }
    static void BindingRefused(string raw) {
      try {SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1(raw);}
      catch(System.InvalidOperationException error) {if(error.Message=="MOBILE_ENROLLMENT_BINDING_UNPROVEN")return;throw;}
      throw new System.Exception("UNTRUSTED_ENROLLMENT_ACCEPTED");
    }
    public static string Run() {
      var result=new System.Collections.Generic.List<object>();
      System.Action<string,System.Action> run=(name,action)=>{try{action();result.Add(new{name,passed=true,reason=""});}catch(System.Exception error){
        while(error is System.Reflection.TargetInvocationException && error.InnerException!=null)error=error.InnerException;
        result.Add(new{name,passed=false,reason=error.GetType().Name+":"+error.Message});}};
      run("existing signed genesis anchors exact deterministic header",()=>{using(var f=new Fixture())Check(f.Anchor.ReadHead()==Head(0,Initial),"GENESIS_BINDING");});
      run("real ephemeral CNG append signs and exactly reads two consecutive commits",()=>{using(var f=new Fixture()){
        f.Anchor.CommitHead(Head(1,Next));f.Anchor.CommitHead(Head(2,Later));
        Check(f.Anchor.ReadHead()==Head(2,Later) && f.Appends==2,"COMMIT_READBACK");}});
      run("absence never creates genesis",()=>{using(var f=new Fixture(false)){Held(()=>f.Anchor.ReadHead());Check(f.Appends==0,"GENESIS_CREATED");}});
      run("old valid WAL prefix sees newer retained anchor",()=>{using(var f=new Fixture()){
        f.Anchor.CommitHead(Head(1,Next));f.Anchor.CommitHead(Head(2,Later));Check(f.Anchor.ReadHead()!=Head(1,Next),"ROLLBACK_HIDDEN");
        Held(()=>f.Anchor.CommitHead(Head(1,Next)));Check(f.Appends==2,"PREFIX_REPLAY_APPENDED");}});
      run("replayed signed genesis after a true commit holds",()=>{using(var f=new Fixture()){
        string genesis=f.Events[0].Text;f.Anchor.CommitHead(Head(1,Next));f.Events.Add(new MobileInstallAnchorEventV1(4,genesis));Held(()=>f.Anchor.ReadHead());}});
      run("duplicate signed terminal holds",()=>{using(var f=new Fixture()){
        f.Anchor.CommitHead(Head(1,Next));f.Events.Add(new MobileInstallAnchorEventV1(4,f.Events[1].Text));Held(()=>f.Anchor.ReadHead());}});
      run("forged latest event is never skipped",()=>{using(var f=new Fixture()){
        f.Events.Add(new MobileInstallAnchorEventV1(3,"forged untrusted event"));Held(()=>f.Anchor.ReadHead());}});
      run("unknown generation before current genesis holds",()=>{using(var f=new Fixture()){
        string text=f.Events[0].Text.Replace("|1|0|","|2|0|");f.Events.Insert(0,new MobileInstallAnchorEventV1(2,text));Held(()=>f.Anchor.ReadHead());}});
      run("unknown generation after current genesis holds",()=>{using(var f=new Fixture()){
        string text=f.Sign(1,Next,Digest(f.Events[0].Text)).Replace("|1|1|","|2|1|");f.Events.Add(new MobileInstallAnchorEventV1(3,text));Held(()=>f.Anchor.ReadHead());}});
      run("wrong machine binding holds even with valid signature",()=>{using(var f=new Fixture()){
        string body=System.String.Join("|",f.Events[0].Text.Split('|'),0,8).Replace(Machine,new string('3',64));
        f.Events[0]=new MobileInstallAnchorEventV1(2,SignRaw(f.Key,body));Held(()=>f.Anchor.ReadHead());}});
      run("wrong operator binding holds even with valid signature",()=>{using(var f=new Fixture()){
        string body=System.String.Join("|",f.Events[0].Text.Split('|'),0,8).Replace(Sid,"S-1-5-21-1-2-3-1002");
        f.Events[0]=new MobileInstallAnchorEventV1(2,SignRaw(f.Key,body));Held(()=>f.Anchor.ReadHead());}});
      run("wrong credential binding holds even with valid signature",()=>{using(var f=new Fixture()){
        string body=System.String.Join("|",f.Events[0].Text.Split('|'),0,8).Replace(Credential,new string('d',64));
        f.Events[0]=new MobileInstallAnchorEventV1(2,SignRaw(f.Key,body));Held(()=>f.Anchor.ReadHead());}});
      run("receipt signature cannot cross into anchor domain",()=>{using(var f=new Fixture()){
        string body=System.String.Join("|",f.Events[0].Text.Split('|'),0,8);
        f.Events[0]=new MobileInstallAnchorEventV1(2,SignRaw(f.Key,body,"stephanos.mobile-installation-receipt.v1\0"));Held(()=>f.Anchor.ReadHead());}});
      run("different signer cannot authenticate anchor",()=>{using(var f=new Fixture())using(var other=System.Security.Cryptography.CngKey.Create(System.Security.Cryptography.CngAlgorithm.ECDsaP256)){
        string body=System.String.Join("|",f.Events[0].Text.Split('|'),0,8);f.Events[0]=new MobileInstallAnchorEventV1(2,SignRaw(other,body));Held(()=>f.Anchor.ReadHead());}});
      run("changed WAL hash without new signature holds",()=>{using(var f=new Fixture()){
        f.Events[0]=new MobileInstallAnchorEventV1(2,f.Events[0].Text.Replace(Initial,Next));Held(()=>f.Anchor.ReadHead());}});
      run("valid signature cannot skip a sequence",()=>{using(var f=new Fixture()){
        f.Events.Add(new MobileInstallAnchorEventV1(3,f.Sign(2,Next,Digest(f.Events[0].Text))));Held(()=>f.Anchor.ReadHead());}});
      run("valid signature cannot substitute predecessor digest",()=>{using(var f=new Fixture()){
        f.Events.Add(new MobileInstallAnchorEventV1(3,f.Sign(1,Next,new string('f',64))));Held(()=>f.Anchor.ReadHead());}});
      run("signed genesis cannot have nonzero predecessor",()=>{using(var f=new Fixture()){
        f.Events[0]=new MobileInstallAnchorEventV1(2,f.Sign(0,Initial,new string('f',64)));Held(()=>f.Anchor.ReadHead());}});
      run("native record identity must strictly advance",()=>{using(var f=new Fixture()){
        f.Events.Add(new MobileInstallAnchorEventV1(2,f.Sign(1,Next,Digest(f.Events[0].Text))));Held(()=>f.Anchor.ReadHead());}});
      run("bootstrap record cannot masquerade as mobile event",()=>{using(var f=new Fixture()){
        f.Events[0]=new MobileInstallAnchorEventV1(1,f.Events[0].Text);Held(()=>f.Anchor.ReadHead());}});
      run("oversized event holds",()=>{using(var f=new Fixture()){
        f.Events.Add(new MobileInstallAnchorEventV1(3,new string('x',1025)));Held(()=>f.Anchor.ReadHead());}});
      run("scan capacity exhaustion holds",()=>{using(var f=new Fixture()){
        while(f.Events.Count<=4096)f.Events.Add(null);Held(()=>f.Anchor.ReadHead());}});
      run("padded signature is noncanonical",()=>{using(var f=new Fixture()){
        f.Events[0]=new MobileInstallAnchorEventV1(2,f.Events[0].Text+"=");Held(()=>f.Anchor.ReadHead());}});
      run("next head cannot change credential",()=>{using(var f=new Fixture()){
        Held(()=>f.Anchor.CommitHead(Head(1,Next).Replace(Credential,new string('d',64))));Check(f.Appends==0,"INVALID_BINDING_APPENDED");}});
      run("next head cannot change generation",()=>{using(var f=new Fixture()){
        Held(()=>f.Anchor.CommitHead(Head(1,Next).Replace("|1|1|","|2|1|")));Check(f.Appends==0,"INVALID_GENERATION_APPENDED");}});
      run("next head cannot carry a path",()=>{using(var f=new Fixture()){
        Held(()=>f.Anchor.CommitHead(Head(1,"C:\\untrusted\\file")));Check(f.Appends==0,"PATH_APPENDED");}});
      run("missing durable append poisons owner and never retries",()=>{using(var f=new Fixture()){
        f.AppendOverride=text=>{};Held(()=>f.Anchor.CommitHead(Head(1,Next)));Held(()=>f.Anchor.CommitHead(Head(1,Next)));Check(f.Appends==1,"UNCERTAIN_REPLAYED");}});
      run("append then lost acknowledgement stays held without replay",()=>{using(var f=new Fixture()){
        f.AppendOverride=text=>{f.Events.Add(new MobileInstallAnchorEventV1(3,text));throw new System.Exception("synthetic acknowledgement loss");};
        Held(()=>f.Anchor.CommitHead(Head(1,Next)));Held(()=>f.Anchor.CommitHead(Head(1,Next)));Check(f.Appends==1 && f.Events.Count==2,"LOST_ACK_REPLAYED");}});
      run("wrong append readback poisons owner",()=>{using(var f=new Fixture()){
        f.AppendOverride=text=>f.Events.Add(new MobileInstallAnchorEventV1(3,text.Replace(Next,Later)));
        Held(()=>f.Anchor.CommitHead(Head(1,Next)));Held(()=>f.Anchor.ReadHead());Check(f.Appends==1,"FORGED_READBACK_REPLAYED");}});
      run("disposed native anchor cannot sign or read",()=>{using(var f=new Fixture()){
        f.Anchor.Dispose();Held(()=>f.Anchor.ReadHead());Held(()=>f.Anchor.CommitHead(Head(1,Next)));}});
      run("receipt key protected ACL allows only system and administrators",()=>{
        typeof(SovereignMobileInstallAnchorV1).GetMethod("AssertKeySecurity",Hidden).Invoke(null,new object[]{Sddl("O:BAG:SYD:P(A;;GA;;;SY)(A;;GA;;;BA)")});});
      foreach(string bad in new[]{"O:BAG:SYD:(A;;GA;;;SY)(A;;GA;;;BA)",
        "O:BAG:SYD:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GR;;;"+Sid+")",
        "O:"+Sid+"G:SYD:P(A;;GA;;;SY)(A;;GA;;;BA)","O:BAG:SYD:P(A;;GA;;;SY)"}) {
        string sddl=bad;run("unsafe receipt-key ACL refused "+result.Count,()=>Held(()=>typeof(SovereignMobileInstallAnchorV1).GetMethod("AssertKeySecurity",Hidden).Invoke(null,new object[]{Sddl(sddl)})));
      }
      run("shared enrollment binding has exact credential domain and immutable metadata",()=>{using(var f=new Fixture()){
        var enrolled=Enrollment(f);var binding=SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1(Json(enrolled));
        var text=new System.Text.StringBuilder("stephanos.mobile-install-credential-binding.v1\0");
        foreach(string name in new[]{"machineHash","operatorSid","rpId","origin","credentialId","publicKeySpki","userHandle","receiptPublicKeySpki"})text.Append((string)enrolled[name]).Append('\0');text.Append('1');
        Check(binding.MachineHash==Machine && binding.OperatorSid==Sid && binding.Generation==1 && binding.LastSignCount==31 &&
          binding.CredentialBindingSha256==Digest(text.ToString()) && binding.ReceiptPublicKeySpki==(string)enrolled["receiptPublicKeySpki"],"ENROLLMENT_BINDING_MISMATCH");
        foreach(var field in binding.GetType().GetFields(Hidden))Check(field.IsInitOnly,"MUTABLE_ENROLLMENT_BINDING");
        foreach(var ctor in binding.GetType().GetConstructors(Hidden))Check(ctor.IsPrivate,"EXPOSED_ENROLLMENT_CONSTRUCTOR");
      }});
      run("shared binding rejects revoked credential",()=>{using(var f=new Fixture()){var e=Enrollment(f);e["revoked"]=true;BindingRefused(Json(e));}});
      run("shared binding rejects duplicate fields before deserialization",()=>{using(var f=new Fixture()){
        BindingRefused(Json(Enrollment(f)).Replace("\"revoked\":false","\"revoked\":false,\"revoked\":false"));}});
      run("shared binding rejects unknown authority fields",()=>{using(var f=new Fixture()){var e=Enrollment(f);e["approved"]=true;BindingRefused(Json(e));}});
      run("shared binding independently validates device key",()=>{using(var f=new Fixture()){var e=Enrollment(f);e["publicKeySpki"]=new string('A',122);BindingRefused(Json(e));}});
      run("shared binding independently validates receipt key",()=>{using(var f=new Fixture()){var e=Enrollment(f);e["receiptPublicKeySpki"]=new string('A',122);BindingRefused(Json(e));}});
      run("shared binding rejects unrelated origin",()=>{using(var f=new Fixture()){var e=Enrollment(f);e["origin"]="https://attacker.example";BindingRefused(Json(e));}});
      run("shared binding rejects fractional generation",()=>{using(var f=new Fixture()){var e=Enrollment(f);e["generation"]=1.5;BindingRefused(Json(e));}});
      run("shared binding rejects excessive counter",()=>{using(var f=new Fixture()){var e=Enrollment(f);e["lastSignCount"]=4294967296L;BindingRefused(Json(e));}});
      run("shared binding rejects escaped lone surrogate",()=>{using(var f=new Fixture()){
        BindingRefused(Json(Enrollment(f)).Replace("\"machineHash\":\""+Machine+"\"","\"machineHash\":\"\\ud800\""));}});
      run("shared binding enforces byte bound",()=>{using(var f=new Fixture()){BindingRefused(new string(' ',8192)+Json(Enrollment(f)));}});
      run("protected counter floor remains independent of credential identity",()=>{using(var f=new Fixture(true,31)){
        Check(f.Anchor.MinimumSignCount==31,"ENROLLMENT_COUNTER_FLOOR_DROPPED");
        Check(typeof(SovereignMobileInstallAnchorV1).GetField("MinimumSignCount",Hidden).IsInitOnly,"MUTABLE_COUNTER_FLOOR");
        Check(f.Anchor.ReadHead()==Head(0,Initial),"COUNTER_CHANGED_HEAD_WIRE");
        f.Anchor.AssertMinimumSignCount(31);f.Anchor.AssertMinimumSignCount(32);
        Held(()=>f.Anchor.AssertMinimumSignCount(30));Check(f.Appends==0,"INVALID_FLOOR_APPENDED");
      }});
      run("shared enrollment counter feeds native floor without changing credential digest",()=>{using(var f=new Fixture()){
        var e=Enrollment(f);var old=SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1(Json(e));
        e["lastSignCount"]=32;var current=SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1(Json(e));
        Check(old.LastSignCount==31 && current.LastSignCount==32 && old.CredentialBindingSha256==current.CredentialBindingSha256,"COUNTER_IDENTITY_CONFLATED");
        using(var floor=new Fixture(true,current.LastSignCount))Held(()=>floor.Anchor.AssertMinimumSignCount(old.LastSignCount));
      }});
      run("setup genesis binds exact header and enrolled counter",()=>{
        string body="STEPHANOS-MOBILE-JOURNAL-V1|"+Credential+"|1|31",hash=Digest("stephanos.mobile-journal-header.v1\0"+body);
        string actual=(string)typeof(SovereignMobileInstallAnchorV1).GetMethod("ValidateGenesisHeader",Hidden).Invoke(null,new object[]{body+"|"+hash+"\n",Credential,1L,31u});
        Check(actual==hash,"GENESIS_HEADER_NOT_BOUND");});
      foreach(uint counter in new[]{30u,32u}) {
        uint value=counter;run("setup genesis rejects mismatched counter "+value,()=>{
          string body="STEPHANOS-MOBILE-JOURNAL-V1|"+Credential+"|1|"+value;
          Held(()=>typeof(SovereignMobileInstallAnchorV1).GetMethod("ValidateGenesisHeader",Hidden).Invoke(null,new object[]{
            body+"|"+Digest("stephanos.mobile-journal-header.v1\0"+body)+"\n",Credential,1L,31u}));});
      }
      run("setup genesis rejects extra WAL records",()=>{
        string body="STEPHANOS-MOBILE-JOURNAL-V1|"+Credential+"|1|31";
        Held(()=>typeof(SovereignMobileInstallAnchorV1).GetMethod("ValidateGenesisHeader",Hidden).Invoke(null,new object[]{
          body+"|"+Digest("stephanos.mobile-journal-header.v1\0"+body)+"\nR1|untrusted\n",Credential,1L,31u}));});
      run("setup genesis refuses redirected enrollment generation",()=>{
        string body="STEPHANOS-MOBILE-JOURNAL-V1|"+Credential+"|2|31";
        Held(()=>typeof(SovereignMobileInstallAnchorV1).GetMethod("ValidateGenesisHeader",Hidden).Invoke(null,new object[]{
          body+"|"+Digest("stephanos.mobile-journal-header.v1\0"+body)+"\n",Credential,1L,31u}));});
      run("setup genesis refuses malformed header digest",()=>{
        string body="STEPHANOS-MOBILE-JOURNAL-V1|"+Credential+"|1|31";
        Held(()=>typeof(SovereignMobileInstallAnchorV1).GetMethod("ValidateGenesisHeader",Hidden).Invoke(null,new object[]{body+"|"+new string('f',64)+"\n",Credential,1L,31u}));});
      return new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(result);
    }
  }
}`;

test('native retained anchor uses real ephemeral CNG signatures and holds rollback, replay, forgery and uncertain append',
  { skip: process.platform !== 'win32', timeout: 40_000 }, t => {
    const root = mkdtempSync(join(tmpdir(), 'stephanos-mobile-anchor-fixture-'));
    const path = join(root, 'anchor-fixture.cs');
    const literal = value => "'" + value.replaceAll("'", "''") + "'";
    try {
      writeFileSync(path, readMobileInstallerNativeSourceV1().map(row => row.bytes.toString('utf8')).join('\n') + '\n' + runner);
      const script = `$ErrorActionPreference='Stop';$PSModuleAutoLoadingPreference='None';` +
        `Import-Module 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop;` +
        `$source=[IO.File]::ReadAllText(${literal(path)});` +
        `Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Core','System.Management','System.Web.Extensions' -ErrorAction Stop;` +
        `[Console]::Write([Stephanos.Sovereign.MobileAnchorFixtureRunnerV1]::Run())`;
      const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { shell: false, windowsHide: true, encoding: 'utf8', timeout: 35_000, maxBuffer: 256 * 1024 });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      const cases = JSON.parse(result.stdout);
      assert.ok(cases.length >= 30);
      for (const row of cases) assert.equal(row.passed, true, `${row.name}: ${row.reason}`);
      t.diagnostic(`${cases.length} native anchor cases; ephemeral CNG only; no production log, key or enrollment mutation`);
    } finally {
      try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      rmdirSync(root);
    }
  });
