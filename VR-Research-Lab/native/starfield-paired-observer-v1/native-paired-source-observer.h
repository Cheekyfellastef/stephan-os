#pragma once
#include "paired-source-observation.h"
#include "gpu-api-observer.h"
#include "gpu-resource-facts.h"
#include "native-paired-observer-owner.h"
#include <new>
#if defined(STEPH_EYE_IMAGE_PROBE) || defined(STEPH_GPU_ORDER_PROBE)
#error Paired observation is a separate seven-hook mode.
#endif

extern native_output::Calibration g_outputCalibration;

// Source-specific observations only. There is deliberately no Pair, Record,
// graphics command, fence, image publication, or OpenXR consumer in this file.
namespace paired_observe {
using Model=paired_observation::Recorder<>;
using Event=Model::Event;
using Kind=paired_observation::Kind;
using SourceBinding=Model::SourceBinding;
Model* model=nullptr; // Initialized before hooks; retained until process exit.
native_gpu::Calibration calibration;
gpu_api::Observer observer;
callback_admission::Gate nativeGate;
std::atomic<unsigned> failure{0},sourceChecks{0},scopeRejected{0},fiberCount{0},openApi{0};
std::atomic<bool> bound{false},fiberPoisoned{false};
std::atomic<uint64_t> beganMs{0};
std::atomic<unsigned> windowReason{0};
DWORD fiberSlot=FLS_OUT_OF_INDEXES;
bool nativeDrained=false,comRestored=false,observerInstallationAttempted=false,coverageOwnedBeforeDisarm=false;
struct Source {
    native_output::Result mapped{};D3D12_RESOURCE_DESC description{};
    native_output::AllocationProof allocation{};uintptr_t rtv=0;
    ID3D12Resource* typed=nullptr;IUnknown* canonical=nullptr;SourceBinding binding{};
};
std::mutex sourceMutex;
Source sources[2]{};bool sourceReady[2]{};
void Fail(unsigned code){unsigned zero=0;failure.compare_exchange_strong(zero,code);if(model)model->Fail(code);g_dualStop.store(true,std::memory_order_release);}
struct Lease {bool entered=nativeGate.Enter();~Lease(){if(entered)nativeGate.Leave();}};
Source SourceAt(unsigned eye){std::lock_guard lock(sourceMutex);return eye<2?sources[eye]:Source{};}
bool SameSource(const Source& a,const Source& b) {
    return a.binding==b.binding && a.mapped.collection==b.mapped.collection
        && a.mapped.row==b.mapped.row && a.mapped.view==b.mapped.view
        && !memcmp(&a.mapped.key,&b.mapped.key,sizeof(a.mapped.key))
        && paired_native_owner::EyeSameDescription(a.description,b.description);
}
// Only called inside the original guarded native output callback. Exact native
// chain, allocation and caller details are reconstructed from the original owner.
void Output(uintptr_t pass,void* parent,void* worker,void* container) {
    Lease lease;if(!lease.entered || failure.load() || !g_record.load())return;
    if(model->Get().phase==paired_observation::Phase::Tail)return;
    if(++sourceChecks>256){Fail(101);return;}
    const auto mapped=paired_native_owner::MapOutput(pass,parent,container);
    uint32_t view=0;unsigned role=2;
    if(!paired_native_owner::EyeView(reinterpret_cast<uintptr_t>(worker),mapped.parent,view,role)
        || mapped.view!=view || role>=2){Fail(102);return;}
    const auto& plan=g_eyeAllocation.plan;
    if(!g_eyeAllocation.ready.load(std::memory_order_acquire) || !g_eyeAllocation.result.valid
        || !g_eyeAllocation.childCopied || !g_eyeAllocation.viewStable
        || mapped.state!=5 || mapped.collection!=plan.collection
        || !native_eye_output::Equal(mapped.key,role?plan.eyeKey:plan.primaryKey)
        || (role?mapped.resource==plan.sourceResource:mapped.resource!=plan.sourceResource)){Fail(103);return;}
    Source candidate;candidate.mapped=mapped;
    if(!native_output::Describe(mapped,g_outputCalibration,candidate.description)
        || !paired_native_owner::EyeDescription(candidate.description)
        || !paired_native_owner::EyeChain(mapped,candidate.rtv)){Fail(104);return;}
    candidate.allocation=paired_native_owner::EyeAllocation(mapped,candidate.description);
    if(!candidate.allocation.committed){Fail(105);return;}
    candidate.typed=reinterpret_cast<ID3D12Resource*>(mapped.resource);
    if(!calibration.Source(candidate.typed)){Fail(106);return;}
    D3D12_HEAP_PROPERTIES heap{};D3D12_HEAP_FLAGS flags{};
    if(FAILED(candidate.typed->GetHeapProperties(&heap,&flags)) || heap.Type!=D3D12_HEAP_TYPE_DEFAULT
        || (flags&(D3D12_HEAP_FLAG_SHARED|D3D12_HEAP_FLAG_SHARED_CROSS_ADAPTER|D3D12_HEAP_FLAG_ALLOW_DISPLAY))
        || calibration.device->GetNodeCount()!=1){Fail(107);return;}
    candidate.typed->AddRef();
    if(FAILED(candidate.typed->QueryInterface(IID_PPV_ARGS(&candidate.canonical))) || !candidate.canonical){candidate.typed->Release();Fail(108);return;}
    uintptr_t repeatedRtv=0;const auto repeated=paired_native_owner::EyeAllocation(mapped,candidate.description);
    if(!paired_native_owner::EyeChain(mapped,repeatedRtv) || repeatedRtv!=candidate.rtv
        || !repeated.committed || repeated.allocation!=candidate.allocation.allocation) {
        candidate.canonical->Release();candidate.typed->Release();Fail(109);return;
    }
    candidate.binding={reinterpret_cast<uintptr_t>(candidate.canonical),
        {mapped.wrapper,mapped.context,mapped.resource,candidate.allocation.allocation,candidate.rtv}};
    bool keep=false,changed=false,complete=false;std::array<SourceBinding,2> pair{};
    {std::lock_guard lock(sourceMutex);
        if(sourceReady[role])changed=!SameSource(sources[role],candidate);
        else {sources[role]=candidate;sourceReady[role]=true;keep=true;}
        complete=sourceReady[0] && sourceReady[1];if(complete){pair={sources[0].binding,sources[1].binding};
            changed=changed || !paired_native_owner::EyeSameDescription(sources[0].description,sources[1].description);}
    }
    if(!keep){candidate.canonical->Release();candidate.typed->Release();}
    if(changed){Fail(110);return;}
    if(complete && !bound.load(std::memory_order_acquire)) {
        const auto counter=paired_native_owner::Counter();
        if(!model->Bind(pair,counter)){Fail(111);return;}
        uint64_t zero=0;beganMs.compare_exchange_strong(zero,GetTickCount64());
        bound.store(true,std::memory_order_release);
    }
}
struct Identity {uintptr_t typed=0,canonical=0;D3D12_COMMAND_LIST_TYPE type=D3D12_COMMAND_LIST_TYPE_BUNDLE;};
std::mutex identityMutex;
Identity identities[1100]{};unsigned identityCount=0;
Identity queues[64]{};unsigned queueCount=0;
Identity QueueIdentity(uintptr_t address) {
    {std::lock_guard lock(identityMutex);for(unsigned i=0;i<queueCount;++i)if(queues[i].typed==address)return queues[i];}
    auto* queue=reinterpret_cast<ID3D12CommandQueue*>(address);
    const bool direct=calibration.DirectQueue(queue),copy=calibration.CopyQueue(queue);
    if(!direct && !copy){Fail(135);return {};}
    IUnknown* canonical=nullptr;
    if(FAILED(queue->QueryInterface(IID_PPV_ARGS(&canonical))) || !canonical){Fail(136);return {};}
    queue->AddRef();Identity result{address,reinterpret_cast<uintptr_t>(canonical),direct?D3D12_COMMAND_LIST_TYPE_DIRECT:D3D12_COMMAND_LIST_TYPE_COPY};bool keep=false;
    {std::lock_guard lock(identityMutex);
        for(unsigned i=0;i<queueCount;++i)if(queues[i].typed==address){
            if(queues[i].canonical!=result.canonical || queues[i].type!=result.type)Fail(137);
            result=queues[i];goto finishedQueue;
        }
        if(queueCount==64){Fail(138);result={};}else {queues[queueCount++]=result;keep=true;}
    finishedQueue:;
    }
    if(!keep){canonical->Release();queue->Release();}return result;
}
Identity ListIdentity(uintptr_t address) {
    {std::lock_guard lock(identityMutex);for(unsigned i=0;i<identityCount;++i)if(identities[i].typed==address)return identities[i];}
    auto* list=reinterpret_cast<ID3D12GraphicsCommandList*>(address);
    if(!calibration.listSignature.Match(list,calibration.listReplacements)
        && !calibration.copyListSignature.Match(list,calibration.copyListReplacements)){Fail(112);return {};}
    if(!calibration.SameDevice(list)){Fail(113);return {};}
    const auto type=list->GetType();
    if((type==D3D12_COMMAND_LIST_TYPE_DIRECT && !calibration.DirectList(list))
        || (type==D3D12_COMMAND_LIST_TYPE_COPY && !calibration.CopyList(list))
        || (type!=D3D12_COMMAND_LIST_TYPE_DIRECT && type!=D3D12_COMMAND_LIST_TYPE_COPY)){Fail(114);return {};}
    IUnknown* canonical=nullptr;
    if(FAILED(list->QueryInterface(IID_PPV_ARGS(&canonical))) || !canonical){Fail(115);return {};}
    list->AddRef();Identity result{address,reinterpret_cast<uintptr_t>(canonical),type};bool keep=false;
    {std::lock_guard lock(identityMutex);
        for(unsigned i=0;i<identityCount;++i)if(identities[i].typed==address){
            if(identities[i].canonical!=result.canonical || identities[i].type!=type)Fail(116);
            result=identities[i];goto finishedIdentity;
        }
        if(identityCount==1100){Fail(117);result={};}
        else {identities[identityCount++]=result;keep=true;}
    finishedIdentity:;
    }
    if(!keep){canonical->Release();list->Release();}return result;
}
// Return 0/1 only for the unique retained canonical source, 2 for known other,
// and -1 for an unclassified pointer. Typed and canonical domains stay separate.
int ResourceRole(uintptr_t address) {
    const auto a=SourceAt(0),b=SourceAt(1);
    if(address==a.binding.binding.resource)return 0;if(address==b.binding.binding.resource)return 1;
    auto* resource=reinterpret_cast<ID3D12Resource*>(address);
    if(!calibration.Source(resource))return -1;
    IUnknown* canonical=nullptr;
    if(FAILED(resource->QueryInterface(IID_PPV_ARGS(&canonical))) || !canonical)return -1;
    const int role=canonical==a.canonical?0:canonical==b.canonical?1:2;canonical->Release();return role;
}
eye_capture::ResourceRelation Relation(uintptr_t address) {
    const int role=ResourceRole(address);return role<0?eye_capture::ResourceRelation::Unknown:
        role<2?eye_capture::ResourceRelation::Source:eye_capture::ResourceRelation::Other;
}
struct Scope {uintptr_t pass=0,worker=0,packet=0,list=0;uint32_t counter=0,view=0,thread=0;unsigned role=2;bool valid=false;SourceBinding binding{};};
bool Current(Scope& scope) {
    const auto mapped=paired_native_owner::FilmOutput(scope.pass,scope.packet);
    uint32_t view=0;unsigned role=2;uintptr_t rtv=0;
    if(!bound.load(std::memory_order_acquire) || failure.load() || scope.thread!=GetCurrentThreadId()
        || !paired_native_owner::EyeView(scope.worker,mapped.parent,view,role) || role>=2
        || view!=scope.view || role!=scope.role || scope.counter!=paired_native_owner::Counter()
        || scope.list!=paired_native_owner::EyeList(scope.worker))return false;
    const auto source=SourceAt(role);const auto allocation=paired_native_owner::EyeAllocation(mapped,source.description);
    const SourceBinding actual{source.binding.canonical,{mapped.wrapper,mapped.context,mapped.resource,allocation.allocation,rtv}};
    if(mapped.state!=5 || !paired_native_owner::EyeChain(mapped,rtv) || rtv!=source.rtv
        || !allocation.committed || mapped.collection!=source.mapped.collection
        || memcmp(&mapped.key,&source.mapped.key,sizeof(mapped.key)))return false;
    auto checked=actual;checked.binding.handle=rtv;
    if(!(checked==source.binding) || (scope.binding.Valid() && !(scope.binding==checked)))return false;
    scope.binding=checked;return true;
}
struct Operation {uint64_t serial=0;uintptr_t object=0;Identity identity{};uint32_t thread=0;bool tracked=false,scoped=false;Scope scope{};unsigned targetRole=2;SourceBinding target{};};
struct Execution {Event event{};std::array<uintptr_t,64> raw{};};
struct Fiber {Scope* scope=nullptr;Operation operations[16]{};Execution executions[8]{};unsigned operationsUsed=0,executionsUsed=0;};
Fiber* State(bool create) {
    if(fiberSlot==FLS_OUT_OF_INDEXES || fiberPoisoned.load())return nullptr;
    auto* state=static_cast<Fiber*>(FlsGetValue(fiberSlot));
    if(!state && create) {
        if(fiberCount.fetch_add(1)>=128){Fail(118);return nullptr;}
        state=new(std::nothrow) Fiber;
        if(!state || !FlsSetValue(fiberSlot,state)){delete state;fiberPoisoned.store(true);Fail(119);return nullptr;}
    }
    return state;
}
struct ScopeRestore {
    Fiber* state=nullptr;Scope* previous=nullptr;Scope* installed=nullptr;
    explicit ScopeRestore(Scope& scope):state(State(true)),installed(&scope) {
        if(state){previous=state->scope;state->scope=&scope;}
    }
    ~ScopeRestore(){const auto error=GetLastError();if(state){if(State(false)!=state || state->scope!=installed){fiberPoisoned.store(true);Fail(120);}else state->scope=previous;}SetLastError(error);}
};
using DrawFn=void(__fastcall*)(void*,void*,void*);
DrawFn originalDraw=nullptr;
void __fastcall Draw(void* pass,void* worker,void* packet) {
    const auto error=GetLastError();Lease lease;Scope scope;ScopeRestore restore(scope);
    if(lease.entered && bound.load() && g_record.load()
        && reinterpret_cast<uintptr_t>(_ReturnAddress())-g_base==paired_native_owner::FilmCaller) {
        scope.pass=reinterpret_cast<uintptr_t>(pass);scope.worker=reinterpret_cast<uintptr_t>(worker);
        scope.packet=reinterpret_cast<uintptr_t>(packet);scope.counter=paired_native_owner::Counter();scope.thread=GetCurrentThreadId();
        scope.list=paired_native_owner::EyeList(scope.worker);
        scope.valid=paired_native_owner::ScopeView(scope.worker,scope.packet,scope.view,scope.role) && Current(scope);
        if(!scope.valid)++scopeRejected;
    }
    SetLastError(error);originalDraw(pass,worker,packet);
}
bool Target(const gpu_api::Event& e,unsigned& role,SourceBinding& binding) {
    role=2;binding={};if(e.kind!=gpu_api::Kind::Targets || e.count!=1
        || e.caller-g_base!=paired_native_owner::TargetCaller)return false;
    const auto actual=native_output::ObserveRtv(Copy,reinterpret_cast<uintptr_t>(e.data),e.count);
    if(!actual.valid)return false;const int found=ResourceRole(actual.resource);if(found<0 || found>=2)return false;
    const auto source=SourceAt(static_cast<unsigned>(found));
    const auto allocation=native_output::CommittedAllocation(Copy,actual.context,actual.resource,source.description.Flags,source.description.Dimension,source.description.Layout);
    binding={source.binding.canonical,{actual.wrapper,actual.context,actual.resource,allocation.allocation,actual.handle}};
    if(!allocation.committed || !(binding==source.binding)){Fail(121);return false;}role=static_cast<unsigned>(found);return true;
}
Event MakeEvent(const gpu_api::Event& e,uintptr_t canonical) {
    Event out;out.list=canonical;out.typedObject=e.object;out.caller=e.caller-g_base;
    out.serial=e.serial;out.counter=paired_native_owner::Counter();out.thread=GetCurrentThreadId();out.nativeDepth=e.nativeDepth;return out;
}
void Api(const gpu_api::Event& e) {
    if(!bound.load(std::memory_order_acquire))return;
    auto* state=State(!e.after);if(!state)return;
    if(e.kind==gpu_api::Kind::Execute) {
        if(!e.count)return;
        if(!e.after) {
            if(failure.load())return;
            if(e.count>64 || state->executionsUsed==8){Fail(122);return;}
            Execution execution;execution.event=MakeEvent(e,0);auto& out=execution.event;out.count=e.count;out.kind=Kind::ExecuteBegin;
            if(!Copy(reinterpret_cast<uintptr_t>(e.data),execution.raw.data(),e.count*sizeof(uintptr_t))){Fail(123);return;}
            bool allDirect=true;for(unsigned i=0;i<e.count;++i){const auto id=ListIdentity(execution.raw[i]);if(!id.canonical)return;
                out.lists[i]=id.canonical;allDirect=allDirect && id.type==D3D12_COMMAND_LIST_TYPE_DIRECT;}
            const auto queue=QueueIdentity(e.object);if(!queue.canonical)return;
            out.queue=queue.canonical;
            out.nativeBatch=queue.type==D3D12_COMMAND_LIST_TYPE_DIRECT && allDirect && out.caller==paired_native_owner::SubmitCaller;
            if(!model->Execution(out)){Fail(126);return;}
            state->executions[state->executionsUsed++]=execution;++openApi;
        } else {
            if(!state->executionsUsed)return;
            auto execution=state->executions[--state->executionsUsed];--openApi;auto& out=execution.event;
            std::array<uintptr_t,64> raw{};
            const bool same=e.count==out.count && e.serial==out.serial && e.object==out.typedObject
                && out.thread==GetCurrentThreadId() && Copy(reinterpret_cast<uintptr_t>(e.data),raw.data(),e.count*sizeof(uintptr_t))
                && raw==execution.raw;
            out.kind=Kind::ExecuteEnd;out.success=same;out.counter=paired_native_owner::Counter();
            if(!same || !model->Execution(out))Fail(127);
        }
        return;
    }
    if(!e.after) {
        if(failure.load())return;
        if(state->operationsUsed==16){Fail(128);return;}
        Operation op;op.serial=e.serial;op.object=e.object;op.thread=GetCurrentThreadId();op.identity=ListIdentity(e.object);
        if(!op.identity.canonical)return;op.tracked=op.identity.type==D3D12_COMMAND_LIST_TYPE_DIRECT;
        if(op.tracked) {
            if(!model->Begin(op.identity.canonical,e.serial,op.thread)){Fail(129);return;}
            if(e.kind==gpu_api::Kind::Targets)Target(e,op.targetRole,op.target);
            if(e.kind==gpu_api::Kind::Draw && state->scope && state->scope->valid && e.object==state->scope->list
                && e.caller-g_base==paired_native_owner::DrawCaller && e.count && e.flags && e.nativeDepth==1) {
                op.scope=*state->scope;op.scoped=Current(op.scope) && observer.Covered();
            }
        }
        state->operations[state->operationsUsed++]=op;++openApi;return;
    }
    if(!state->operationsUsed)return;
    const auto op=state->operations[--state->operationsUsed];--openApi;
    if(op.serial!=e.serial || op.object!=e.object || op.thread!=GetCurrentThreadId()){Fail(130);return;}
    if(!op.tracked || failure.load())return;
    auto event=MakeEvent(e,op.identity.canonical);
    const UINT stride=e.kind==gpu_api::Kind::Targets && e.flags?calibration.device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_RTV):0;
    const auto facts=eye_capture::InspectResourceFacts(e,Copy,Relation,stride);
    if(!facts.known){event.kind=Kind::Opaque;model->Complete(event);return;}
    switch(e.kind) {
    case gpu_api::Kind::Reset:event.kind=Kind::Reset;event.success=SUCCEEDED(e.result);break;
    case gpu_api::Kind::Close:event.kind=Kind::Close;event.success=SUCCEEDED(e.result);break;
    case gpu_api::Kind::Predication:event.kind=Kind::Predication;event.success=e.resource!=0;break;
    case gpu_api::Kind::ClearState:event.kind=Kind::ClearTargets;break;
    case gpu_api::Kind::Targets: {
        unsigned role=2;SourceBinding target;
        if(Target(e,role,target) && role==op.targetRole && target==op.target){event.kind=Kind::Targets;event.role=role;model->Complete(event,&target);}
        else {event.kind=Kind::ClearTargets;model->Complete(event);}return;
    }
    case gpu_api::Kind::Barrier: {
        unsigned roles[64]{};uint32_t before[64]{},after[64]{};bool whole[64]{};
        for(unsigned i=0;i<facts.transitionCount;++i){const auto& b=facts.transitions[i];const int role=ResourceRole(reinterpret_cast<uintptr_t>(b.Transition.pResource));
            if(role<0 || role>=2){Fail(131);return;}roles[i]=static_cast<unsigned>(role);
            before[i]=b.Transition.StateBefore;after[i]=b.Transition.StateAfter;
            whole[i]=b.Flags==D3D12_RESOURCE_BARRIER_FLAG_NONE && (b.Transition.Subresource==D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES || b.Transition.Subresource==0);}
        model->Barriers(event,roles,before,after,whole,facts.transitionCount,facts.aliases);return;
    }
    case gpu_api::Kind::Draw:
        if(op.scoped){auto scope=op.scope;event.kind=Kind::Draw;event.role=scope.role;
            event.success=state->scope && state->scope->valid && Current(scope) && observer.Covered();
            model->Complete(event,&scope.binding);return;}
        model->EndUnreported(event.list,event.serial,event.thread);return;
    case gpu_api::Kind::BeginPass:case gpu_api::Kind::EndPass:case gpu_api::Kind::Bundle:case gpu_api::Kind::Unsupported:
        event.kind=Kind::Opaque;break;
    default:model->EndUnreported(event.list,event.serial,event.thread);return;
    }
    if(!model->Complete(event))Fail(132);
}
bool Initialize(ID3D12Device* device) {
    if(model)return false;model=new(std::nothrow) Model;if(!model)return false;
    fiberSlot=FlsAlloc(nullptr);
    if(fiberSlot==FLS_OUT_OF_INDEXES || !calibration.Initialize(device) || !calibration.InitializeCopy()
        || !observer.Configure(calibration,Api))return false;
    observerInstallationAttempted=true;if(!observer.Install())return false;
    nativeGate.Open();return true;
}
bool Poll() {
    if(failure.load() || gpu_api::sinkFaulted.load() || model->Get().invalid){windowReason.store(4);return true;}
    const auto status=model->Get();if(status.phase==paired_observation::Phase::Tail){windowReason.store(3);return true;}
    if(!bound.load())return false;const auto counter=paired_native_owner::Counter();
    if(counter<status.startCounter){Fail(133);return true;}
    if(counter-status.startCounter>=6 || GetTickCount64()-beganMs.load()>=2000){windowReason.store(counter-status.startCounter>=6?1u:2u);model->Cut(counter);return true;}
    return false;
}
bool StopBeforeRestore() {
    unsigned zero=0;windowReason.compare_exchange_strong(zero,5);
    if(model)model->Cut(paired_native_owner::Counter());nativeGate.Close();
    coverageOwnedBeforeDisarm=observerInstallationAttempted && observer.Covered();observer.Disarm();
    nativeDrained=nativeGate.Wait(5000);return nativeDrained;
}
void Finish(HANDLE output) {
    comRestored=!observerInstallationAttempted || observer.Restore();if(!comRestored)comRestored=observer.Restore();
    if(!model){Write(output,"{\"pairedSourceObservation\":true,\"initializationFailed\":true,\"pixelsCaptured\":false}\n");return;}
    if(!nativeDrained)nativeDrained=nativeGate.Wait(5000);
    model->Stop();const auto state=model->Get();const auto receipt=observer.Receipt();char line[8192];
    sprintf_s(line,"{\"pairedSourceObservation\":true,\"schema\":1,\"bound\":%s,\"failure\":%u,\"modelFailure\":%u,\"invalid\":%s,\"records\":%u,\"attempted\":%u,\"dropped\":%u,\"sourceChecks\":%u,\"scopeRejected\":%u,\"draws\":[%u,%u],\"transitions\":[%u,%u],\"resets\":%u,\"executePairs\":%u,\"suppressedUnrelatedOrOutsideWindow\":%u,\"opaqueCallbacks\":%u,\"windowReason\":%u,\"observationIsDiagnosticOnly\":true,\"startCounter\":%u,\"cutCounter\":%u,\"nativeDrained\":%s,\"comRestored\":%s,\"coverageOwnedBeforeDisarm\":%s,\"openApi\":%u,\"sinkFaulted\":%s,\"fiberPoisoned\":%s,\"slotsRestored\":%s,\"calleeBytesUnchanged\":%s,\"exactPageFlagsRestored\":%s,\"gpuCopyCommandsIssued\":false,\"imagesRecorded\":false,\"pixelsCaptured\":false,\"gpuCompletionProven\":false,\"openxrSubmitted\":false,\"sameSimulationUpdateProven\":false}\n",
        bound.load()?"true":"false",failure.load(),state.failure,state.invalid?"true":"false",state.records,state.attempted,state.dropped,
        sourceChecks.load(),scopeRejected.load(),state.draws[0],state.draws[1],state.transitions[0],state.transitions[1],state.resets,state.executePairs,state.suppressed,state.opaque,windowReason.load(),
        state.startCounter,state.cutCounter,nativeDrained?"true":"false",comRestored?"true":"false",coverageOwnedBeforeDisarm?"true":"false",openApi.load(),gpu_api::sinkFaulted.load()?"true":"false",
        fiberPoisoned.load()?"true":"false",receipt.slotsRestored?"true":"false",receipt.calleeBytesUnchanged?"true":"false",receipt.exactPageFlagsRestored?"true":"false");Write(output,line);
    for(unsigned i=0;i<state.records;++i){Event e;if(!model->Read(i,e)){Fail(134);break;}
        int used=sprintf_s(line,"{\"pairedEvent\":%u,\"sequence\":%llu,\"serial\":%llu,\"list\":%llu,\"typedObject\":%llu,\"generation\":%llu,\"caller\":%llu,\"sourceCanonical\":%llu,\"typedResource\":%llu,\"queueCanonical\":%llu,\"role\":%u,\"counterCandidate\":%u,\"thread\":%u,\"before\":%u,\"afterState\":%u,\"nativeDepth\":%u,\"success\":%s,\"coveredResetGeneration\":%s,\"wholeUnsplit\":%s,\"nativeDirectBatch\":%s,\"count\":%u,\"lists\":[",
            static_cast<unsigned>(e.kind),e.sequence,e.serial,e.list,e.typedObject,e.generation,e.caller,e.source,e.typedResource,e.queue,e.role,e.counter,e.thread,
            e.before,e.afterState,e.nativeDepth,e.success?"true":"false",e.covered?"true":"false",e.whole?"true":"false",e.nativeBatch?"true":"false",e.count);
        for(unsigned j=0;j<e.count;++j)used+=sprintf_s(line+used,sizeof(line)-used,"%s[%llu,%llu]",j?",":"",e.lists[j],e.generations[j]);
        sprintf_s(line+used,sizeof(line)-used,"]}\n");Write(output,line);
    }
}
#ifdef STEPH_NATIVE_TRACE_SELF_TEST
unsigned testForwardCalls=0;
void __fastcall TestForward(void* a,void* b,void* c) {
    if(a==reinterpret_cast<void*>(1) && b==reinterpret_cast<void*>(2) && c==reinterpret_cast<void*>(3)
        && GetLastError()==41)++testForwardCalls;
    SetLastError(47);
}
void __fastcall TestUnwind(void*,void*,void*){++testForwardCalls;SetLastError(59);throw 73;}
struct FiberTest {void* main=nullptr;unsigned stage=0;bool valid=false;};
void WINAPI TestFiber(void* context) {
    auto& test=*static_cast<FiberTest*>(context);Scope scope;
    {ScopeRestore restore(scope);test.valid=State(false) && State(false)->scope==&scope;test.stage=1;SwitchToFiber(test.main);
        test.valid=test.valid && State(false) && State(false)->scope==&scope;
        {Scope nested;ScopeRestore inner(nested);test.valid=test.valid && State(false)->scope==&nested;}
        test.valid=test.valid && State(false)->scope==&scope;
    }
    test.valid=test.valid && State(false) && !State(false)->scope;test.stage=2;SwitchToFiber(test.main);
}
bool SelfTest() {
    fiberSlot=FlsAlloc(nullptr);if(fiberSlot==FLS_OUT_OF_INDEXES)return false;
    nativeGate.Open();originalDraw=TestForward;SetLastError(41);
    Draw(reinterpret_cast<void*>(1),reinterpret_cast<void*>(2),reinterpret_cast<void*>(3));
    if(testForwardCalls!=1 || GetLastError()!=47 || !State(false) || State(false)->scope)return false;
    originalDraw=TestUnwind;bool caught=false;
    try{Draw(nullptr,nullptr,nullptr);}catch(int value){caught=value==73;}
    if(!caught || testForwardCalls!=2 || GetLastError()!=59 || State(false)->scope)return false;
    const bool wasFiber=IsThreadAFiber()!=FALSE;void* main=wasFiber?GetCurrentFiber():ConvertThreadToFiber(nullptr);
    if(!main)return false;FiberTest a{main},b{main};
    void* fa=CreateFiber(64*1024,TestFiber,&a);void* fb=CreateFiber(64*1024,TestFiber,&b);
    if(!fa || !fb)return false;SwitchToFiber(fa);SwitchToFiber(fb);
    if(a.stage!=1 || b.stage!=1)return false;SwitchToFiber(fa);SwitchToFiber(fb);
    const bool good=a.stage==2 && b.stage==2 && a.valid && b.valid;
    DeleteFiber(fa);DeleteFiber(fb);if(!wasFiber && !ConvertFiberToThread())return false;
    if(!good)return false;
    {Scope scope;ScopeRestore restore(scope);if(!restore.state)return false;restore.state->scope=nullptr;}
    if(!fiberPoisoned.load() || State(false))return false;
    originalDraw=TestForward;SetLastError(41);Draw(reinterpret_cast<void*>(1),reinterpret_cast<void*>(2),reinterpret_cast<void*>(3));
    if(testForwardCalls!=3 || GetLastError()!=47)return false;
    nativeGate.Close();if(!nativeGate.Wait(1000) || openApi.load())return false;
    puts("Paired observer ABI/FLS tests passed: original forwarded once, last error, unwind, non-LIFO fibers, terminal poison; no game or GPU execution.");return true;
}
#endif
}
