#pragma once
#include <array>
#include <cstdint>
#include <mutex>

namespace eye_capture {
// Post-draw snapshots, conditional on valid native D3D12 resource ownership.
// Every id is a retained canonical COM identity, never a caller-supplied alias.
// A local whole-source transition proves the insertion state; this model makes
// no global claim about disjoint lists, final-frame contents, or simulation time.
template<unsigned Capacity=1024> class ScopedLedger {
public:
    struct Binding {
        uintptr_t wrapper=0,context=0,resource=0,allocation=0,handle=0;
        bool Valid()const{return wrapper && context && resource && allocation && handle;}
        bool operator==(const Binding&)const=default;
    };
    // canonical is retained IUnknown identity; binding.resource is the typed
    // ID3D12Resource pointer. They are separate domains and need not be equal.
    struct SourceBinding {
        uintptr_t canonical=0;
        Binding binding{};
        bool Valid()const{return canonical && binding.Valid();}
        bool operator==(const SourceBinding&)const=default;
    };
    struct Ticket {uintptr_t list=0;uint64_t generation=0,drawSerial=0;uint32_t counter=0,thread=0;unsigned eye=2;Binding binding{};uintptr_t sourceCanonical=0;};
    struct Eye {Ticket ticket{};bool reserved=false,recorded=false,boundary=false,submitted=false,retired=false;};
    struct Submission {uintptr_t queue=0;uint64_t serial=0,generation=0;unsigned eye=2,count=0;bool valid=false,relevant=false;std::array<uintptr_t,64> ids{};};
    struct Status {bool invalid=false;uintptr_t source=0,sourceQueue=0;unsigned lists=0;uint64_t rejected=0,disjointBatches=0;std::array<uint64_t,11> rejectReasons{};std::array<Eye,2> eyes{};bool pairedSources=false;std::array<SourceBinding,2> sources{};};
private:
    struct SourceState {bool known=false;uint32_t state=0;};
    struct List {uintptr_t id=0;uint64_t generation=0,lease=0,operation=0;bool open=false,closed=false,covered=false,opaque=false,
        target=false,predicated=false;uint32_t operationThread=0;Binding binding{};uintptr_t targetCanonical=0;
        std::array<SourceState,2> sourceStates{};};
    mutable std::mutex mutex;
    std::array<List,Capacity> lists{};
    Status status;
    uint64_t activeSubmission=0;
    Submission activeReceipt{};
    List* Find(uintptr_t id,bool create=false) {
        if(!id)return nullptr;
        for(unsigned i=0;i<status.lists;++i)if(lists[i].id==id)return &lists[i];
        if(!create)return nullptr;
        if(status.lists==Capacity){status.invalid=true;return nullptr;}
        auto& list=lists[status.lists++];list.id=id;return &list;
    }
    static bool Same(const Ticket& a,const Ticket& b) {
        return a.list==b.list && a.generation==b.generation && a.drawSerial==b.drawSerial
            && a.counter==b.counter && a.thread==b.thread && a.eye==b.eye && a.binding==b.binding
            && a.sourceCanonical==b.sourceCanonical;
    }
    unsigned StateIndex(unsigned eye)const{return status.pairedSources?eye:0;}
    uintptr_t SourceForEye(unsigned eye)const{return status.pairedSources?status.sources[eye].canonical:status.source;}
    bool TicketSource(const Ticket& ticket)const {
        return ticket.eye<2 && ticket.sourceCanonical==SourceForEye(ticket.eye)
            && (!status.pairedSources || ticket.binding==status.sources[ticket.eye].binding);
    }
    bool Local(const List* list,unsigned eye)const {
        if(eye>=2 || !list)return false;
        const auto& state=list->sourceStates[StateIndex(eye)];
        return list->covered && list->open && !list->closed && !list->opaque
            && state.known && state.state==4 && list->target && !list->predicated
            && list->targetCanonical==SourceForEye(eye);
    }
    bool ObservedSource(unsigned eye,const SourceBinding& observed) {
        if(status.invalid || !status.pairedSources || eye>=2 || !observed.Valid()
            || !(observed==status.sources[eye])) {status.invalid=true;return false;}
        return true;
    }
    void Transition(List* list,unsigned index,uint32_t before,uint32_t after,bool wholeUnsplit) {
        if(!list || !list->covered || !list->open)return;
        if(list->lease)status.invalid=true;
        auto& state=list->sourceStates[index];
        if(!wholeUnsplit || before==after || (state.known && state.state!=before)) {
            list->opaque=true;state.known=false;return;
        }
        // An emitted transition establishes state only for this exact source
        // on this command-list recording generation.
        state.state=after;state.known=true;
    }
public:
    bool BindSource(uintptr_t retainedCanonicalSource) {
        std::lock_guard lock(mutex);
        if(status.invalid || status.pairedSources || !retainedCanonicalSource
            || (status.source && status.source!=retainedCanonicalSource)) {status.invalid=true;return false;}
        status.source=retainedCanonicalSource;return true;
    }
    // Atomic registration of an immutable, role-ordered pair. Native allocation,
    // graph/key, camera, descriptor and COM lifetime proofs remain adapter-owned.
    // Distinct numeric identities alone do not prove disjoint physical memory.
    bool BindPairedSources(const std::array<SourceBinding,2>& sources) {
        std::lock_guard lock(mutex);
        const auto& left=sources[0];const auto& right=sources[1];
        const bool distinct=left.canonical!=right.canonical
            && left.binding.wrapper!=right.binding.wrapper && left.binding.context!=right.binding.context
            && left.binding.resource!=right.binding.resource && left.binding.allocation!=right.binding.allocation
            && left.binding.handle!=right.binding.handle;
        if(status.invalid || !left.Valid() || !right.Valid() || !distinct
            || (status.source && (!status.pairedSources || status.sources!=sources))) {
            status.invalid=true;return false;
        }
        status.sources=sources;status.pairedSources=true;status.source=left.canonical;return true;
    }
    void Invalidate(){std::lock_guard lock(mutex);status.invalid=true;}
    // Covers the pre/native/post interval, not just the already acquired draw lease.
    // Own inserted commands bypass observation and remain under that draw's interval.
    bool BeginOperation(uintptr_t id,uint64_t serial,uint32_t thread) {
        std::lock_guard lock(mutex);if(status.invalid || !status.source)return false;auto* list=Find(id,true);if(!list)return false;
        if(!serial || !thread || list->operation || list->lease){status.invalid=true;return false;}
        list->operation=serial;list->operationThread=thread;return true;
    }
    void EndOperation(uintptr_t id,uint64_t serial,uint32_t thread) {
        std::lock_guard lock(mutex);if(!status.source)return;auto* list=Find(id);
        if(!list || list->operation!=serial || list->operationThread!=thread || list->lease){status.invalid=true;return;}
        list->operation=0;list->operationThread=0;
    }
    void Reset(uintptr_t id,bool success) {
        std::lock_guard lock(mutex);if(!status.source)return;auto* list=Find(id,true);if(!list)return;
        if(list->lease){status.invalid=true;return;}
        if(!success){list->covered=false;list->opaque=true;
            for(const auto& eye:status.eyes)if(eye.reserved && eye.ticket.list==id && eye.ticket.generation==list->generation)status.invalid=true;
            return;
        }
        for(auto& eye:status.eyes)if(eye.reserved && eye.ticket.list==id && eye.ticket.generation==list->generation) {
            if(!eye.submitted || activeSubmission)status.invalid=true;else eye.retired=true;
        }
        const auto generation=list->generation+1,operation=list->operation;const auto thread=list->operationThread;
        *list={};list->id=id;list->generation=generation;list->covered=true;list->open=true;
        list->operation=operation;list->operationThread=thread;
    }
    void Targets(uintptr_t id,Binding binding) {
        std::lock_guard lock(mutex);
        if(status.pairedSources){status.invalid=true;return;}
        auto* list=Find(id);if(!list || !list->covered || !list->open)return;
        if(list->lease)status.invalid=true;list->binding=binding;list->target=binding.Valid();
        list->targetCanonical=list->target?status.source:0;
    }
    void TargetsForSource(uintptr_t id,unsigned eye,const SourceBinding& observed) {
        std::lock_guard lock(mutex);if(!ObservedSource(eye,observed))return;
        auto* list=Find(id);if(!list || !list->covered || !list->open)return;
        if(list->lease){status.invalid=true;return;}
        // There is one current RTV target, not one independently current target
        // per eye. Binding the extra target replaces the primary target.
        list->binding=observed.binding;list->target=true;list->targetCanonical=observed.canonical;
    }
    void ClearTargets(uintptr_t id) {
        std::lock_guard lock(mutex);auto* list=Find(id);if(!list || !list->covered || !list->open)return;
        if(list->lease){status.invalid=true;return;}
        list->binding={};list->target=false;list->targetCanonical=0;
    }
    void Predication(uintptr_t id,bool enabled) {
        std::lock_guard lock(mutex);auto* list=Find(id);if(!list || !list->covered || !list->open)return;
        if(list->lease)status.invalid=true;list->predicated=enabled;
    }
    void Opaque(uintptr_t id) {
        std::lock_guard lock(mutex);auto* list=Find(id);if(!list)return;
        if(list->lease)status.invalid=true;list->opaque=true;
        for(auto& state:list->sourceStates)state.known=false;
    }
    void Barrier(uintptr_t id,uint32_t before,uint32_t after,bool wholeUnsplit) {
        std::lock_guard lock(mutex);
        if(status.pairedSources){status.invalid=true;return;}
        Transition(Find(id),0,before,after,wholeUnsplit);
    }
    void BarrierForSource(uintptr_t id,unsigned eye,const SourceBinding& observed,
                          uint32_t before,uint32_t after,bool wholeUnsplit) {
        std::lock_guard lock(mutex);if(!ObservedSource(eye,observed))return;
        Transition(Find(id),eye,before,after,wholeUnsplit);
    }
    Ticket BeginDraw(uintptr_t id,uint32_t counter,unsigned eyeIndex,uint32_t thread,uint64_t serial,const Binding& expectedBinding) {
        std::lock_guard lock(mutex);auto* list=Find(id);
        const auto reject=[&](unsigned reason){++status.rejected;++status.rejectReasons[reason];return Ticket{};};
        if(status.invalid || !status.source)return reject(0);
        if(eyeIndex>=2 || status.eyes[eyeIndex].reserved)return reject(9);
        if(!list || !list->covered)return reject(1);
        if(!list->open || list->closed)return reject(2);
        if(list->opaque)return reject(3);
        const auto& state=list->sourceStates[StateIndex(eyeIndex)];
        if(!state.known)return reject(4);
        if(state.state!=4)return reject(5);
        if(!list->target || !expectedBinding.Valid() || !(list->binding==expectedBinding)
            || list->targetCanonical!=SourceForEye(eyeIndex)
            || (status.pairedSources && !(expectedBinding==status.sources[eyeIndex].binding)))return reject(6);
        if(list->predicated)return reject(7);
        if(!serial || !thread || list->lease || list->operation!=serial || list->operationThread!=thread)return reject(8);
        if(eyeIndex==1 && (!status.eyes[0].recorded || status.eyes[0].ticket.counter!=counter
            || (status.eyes[0].ticket.list==id && status.eyes[0].ticket.generation==list->generation)))return reject(10);
        Ticket ticket{id,list->generation,serial,counter,thread,eyeIndex,expectedBinding,SourceForEye(eyeIndex)};
        list->lease=serial;status.eyes[eyeIndex].ticket=ticket;status.eyes[eyeIndex].reserved=true;return ticket;
    }
    bool CanCopy(const Ticket& ticket,uint32_t thread)const {
        std::lock_guard lock(mutex);if(status.invalid || !TicketSource(ticket) || ticket.thread!=thread)return false;
        const List* list=nullptr;for(unsigned i=0;i<status.lists;++i)if(lists[i].id==ticket.list)list=&lists[i];
        const auto& eye=status.eyes[ticket.eye];
        return Local(list,ticket.eye) && list->lease==ticket.drawSerial && list->operation==ticket.drawSerial
            && list->operationThread==thread && list->generation==ticket.generation && list->binding==ticket.binding
            && eye.reserved && !eye.recorded && Same(eye.ticket,ticket);
    }
    bool Recorded(const Ticket& ticket,bool success) {
        std::lock_guard lock(mutex);if(ticket.eye>=2){status.invalid=true;return false;}
        auto* list=Find(ticket.list);auto& eye=status.eyes[ticket.eye];
        const bool valid=success && !status.invalid && TicketSource(ticket) && Local(list,ticket.eye) && list->lease==ticket.drawSerial
            && list->operation==ticket.drawSerial && list->operationThread==ticket.thread
            && list->binding==ticket.binding
            && list->generation==ticket.generation && eye.reserved && !eye.recorded && Same(eye.ticket,ticket);
        if(list && list->lease==ticket.drawSerial)list->lease=0;
        if(!valid){status.invalid=true;return false;}eye.recorded=true;return true;
    }
    void Boundary(uintptr_t id,uint32_t counter,unsigned eyeIndex) {
        std::lock_guard lock(mutex);if(eyeIndex>=2)return;auto* list=Find(id);auto& eye=status.eyes[eyeIndex];
        if(list && eye.recorded && eye.ticket.list==id && eye.ticket.generation==list->generation
            && eye.ticket.counter==counter)eye.boundary=true;
        // Advisory association only. This image is the post-draw snapshot, not final output.
    }
    void Close(uintptr_t id,bool success) {
        std::lock_guard lock(mutex);auto* list=Find(id);if(!list)return;
        if(list->lease)status.invalid=true;
        list->closed=success && list->covered && list->open;list->open=false;
        for(const auto& eye:status.eyes)if(eye.reserved && eye.ticket.list==id && eye.ticket.generation==list->generation)
            if(!list->closed || !eye.recorded)status.invalid=true;
    }
    // Adapter verifies every ordered canonical identity, all DIRECT for a selected
    // native batch. Unknown/truncated arrays must invalidate rather than be skipped.
    Submission BeginSubmission(uintptr_t queue,const uintptr_t* ids,unsigned count,bool nativeDirectBatch,uint64_t serial) {
        std::lock_guard lock(mutex);Submission out;out.queue=queue;out.serial=serial;out.count=count;
        if(!status.source || !queue || !serial || !ids || !count || count>64){status.invalid=true;return out;}
        unsigned matches=0,index=0;
        for(unsigned i=0;i<count;++i) {
            out.ids[i]=ids[i];
            if(!ids[i]){status.invalid=true;return out;}
            for(unsigned j=0;j<i;++j)if(ids[j]==ids[i]){status.invalid=true;return out;}
            auto* list=Find(ids[i]);if(!list)continue;
            for(unsigned eyeIndex=0;eyeIndex<2;++eyeIndex) {
                const auto& eye=status.eyes[eyeIndex];
                if(eye.reserved && eye.ticket.list==ids[i] && eye.ticket.generation==list->generation) {
                    ++matches;index=i;out.eye=eyeIndex;out.generation=list->generation;
                }
            }
        }
        if(!matches){++status.disjointBatches;out.valid=true;return out;}
        out.relevant=true;
        if(status.invalid || matches!=1 || index+1!=count || !nativeDirectBatch || activeSubmission
            || (status.sourceQueue && status.sourceQueue!=queue)){status.invalid=true;return out;}
        auto& eye=status.eyes[out.eye];auto* list=Find(eye.ticket.list);
        if(!list || !list->closed || list->open || list->lease || list->operation || !eye.recorded || eye.submitted
            || (out.eye==1 && !status.eyes[0].submitted)){status.invalid=true;return out;}
        if(!status.sourceQueue)status.sourceQueue=queue;
        activeSubmission=serial;out.valid=true;activeReceipt=out;return out;
    }
    bool Submitted(const Submission& submission) {
        std::lock_guard lock(mutex);
        if(!submission.valid){status.invalid=true;return false;}
        if(!submission.relevant)return !status.invalid;
        if(status.invalid || submission.eye>=2 || activeSubmission!=submission.serial
            || status.sourceQueue!=submission.queue || activeReceipt.eye!=submission.eye
            || activeReceipt.generation!=submission.generation || activeReceipt.count!=submission.count
            || activeReceipt.ids!=submission.ids){status.invalid=true;return false;}
        auto& eye=status.eyes[submission.eye];auto* list=Find(eye.ticket.list);
        if(!list || list->generation!=submission.generation || !list->closed || list->open || eye.submitted) {
            status.invalid=true;return false;
        }
        eye.submitted=true;activeSubmission=0;return true;
    }
    bool ReadyForFence()const {
        std::lock_guard lock(mutex);return !status.invalid && !activeSubmission && status.sourceQueue
            && status.eyes[0].submitted && status.eyes[1].submitted && status.eyes[0].retired && status.eyes[1].retired;
    }
    Status Get()const {std::lock_guard lock(mutex);return status;}
};
}
