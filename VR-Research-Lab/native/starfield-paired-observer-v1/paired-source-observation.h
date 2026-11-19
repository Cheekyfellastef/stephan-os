#pragma once
#include "scoped-eye-ledger.h"
#include <array>
#include <cstdint>
#include <mutex>

// Diagnostic observations only. This class cannot reserve a copy, acknowledge a
// recorded image, admit a submission, signal a fence, or publish GPU completion.
namespace paired_observation {
enum class Kind : unsigned { Bind=1,Reset,Close,Targets,ClearTargets,Barrier,
    Predication,Opaque,Draw,ExecuteBegin,ExecuteEnd,Boundary,WindowEnd };
enum class Phase : unsigned { Unbound,Collecting,Tail,Stopped };
template<unsigned ListCapacity=1024,unsigned EventCapacity=8192,unsigned TailReserve=1024>
class Recorder {
    static_assert(EventCapacity>TailReserve && TailReserve>2);
public:
    using Ledger=eye_capture::ScopedLedger<ListCapacity>;
    using Binding=typename Ledger::Binding;
    using SourceBinding=typename Ledger::SourceBinding;
    struct Event {
        Kind kind{};uint64_t sequence=0,serial=0,generation=0;
        uintptr_t list=0,typedObject=0,caller=0,source=0,typedResource=0,queue=0;
        uint32_t counter=0,thread=0,before=0,afterState=0;
        unsigned role=2,count=0,nativeDepth=0;
        bool success=false,covered=false,whole=false,nativeBatch=false;
        std::array<uintptr_t,64> lists{};
        std::array<uint64_t,64> generations{};
    };
    struct Status {
        Phase phase=Phase::Unbound;bool invalid=false;unsigned failure=0;
        unsigned records=0,attempted=0,dropped=0,lists=0;
        uint32_t startCounter=0,cutCounter=0;
        std::array<unsigned,2> draws{},transitions{};
        unsigned resets=0,executePairs=0,suppressed=0,opaque=0;
    };
private:
    struct List {uintptr_t id=0;uint64_t generation=0,operation=0;
        uint32_t thread=0;bool covered=false,watched=false,journalReset=false;};
    struct Pending {Event event{};bool used=false,watched=false;};
    mutable std::mutex mutex_;
    Ledger ledger_;
    std::array<SourceBinding,2> sources_{};
    std::array<List,ListCapacity> lists_{};
    std::array<Event,EventCapacity> events_{};
    std::array<Pending,64> pending_{};
    Status state_{};
    void FailLocked(unsigned reason) {state_.invalid=true;if(!state_.failure)state_.failure=reason;ledger_.Invalidate();}
    List* Find(uintptr_t id,bool create=false) {
        if(!id)return nullptr;
        for(unsigned i=0;i<state_.lists;++i)if(lists_[i].id==id)return &lists_[i];
        if(!create)return nullptr;
        if(state_.lists==ListCapacity){FailLocked(1);return nullptr;}
        auto& row=lists_[state_.lists++];row.id=id;return &row;
    }
    bool Store(Event event,bool tail=false) {
        if(state_.phase==Phase::Stopped || state_.invalid)return false;
        if(state_.phase==Phase::Tail && !tail)return false;
        ++state_.attempted;
        if(state_.records==EventCapacity){++state_.dropped;FailLocked(2);return false;}
        event.sequence=state_.records+1;events_[state_.records++]=event;
        if(state_.phase==Phase::Collecting && state_.records>=EventCapacity-TailReserve) {
            state_.phase=Phase::Tail;state_.cutCounter=event.counter;
        }
        return true;
    }
    bool Finish(List* list,const Event& event) {
        if(!list || list->operation!=event.serial || list->thread!=event.thread){FailLocked(3);return false;}
        ledger_.EndOperation(event.list,event.serial,event.thread);
        list->operation=0;list->thread=0;
        if(ledger_.Get().invalid){FailLocked(4);return false;}
        return true;
    }
public:
    bool Bind(const std::array<SourceBinding,2>& pair,uint32_t counter) {
        std::lock_guard lock(mutex_);
        if(state_.invalid || state_.phase==Phase::Stopped || !ledger_.BindPairedSources(pair)){FailLocked(5);return false;}
        if(state_.phase!=Phase::Unbound)return sources_==pair;
        sources_=pair;state_.phase=Phase::Collecting;state_.startCounter=counter;
        for(unsigned role=0;role<2;++role){Event e;e.kind=Kind::Bind;e.role=role;e.counter=counter;
            e.source=pair[role].canonical;e.typedResource=pair[role].binding.resource;e.success=true;Store(e);}
        return !state_.invalid;
    }
    bool Begin(uintptr_t list,uint64_t serial,uint32_t thread) {
        std::lock_guard lock(mutex_);
        if(state_.invalid || state_.phase==Phase::Unbound || state_.phase==Phase::Stopped)return false;
        auto* row=Find(list,true);
        if(!row || !ledger_.BeginOperation(list,serial,thread)){FailLocked(6);return false;}
        row->operation=serial;row->thread=thread;return true;
    }
    // Complete one genuine pre/native/post bracket. The adapter copies foreign
    // arguments while they are live; COM and native memory access stay outside.
    bool Complete(Event event,const SourceBinding* observed=nullptr) {
        std::lock_guard lock(mutex_);auto* row=Find(event.list);
        if(state_.invalid || !row || row->operation!=event.serial || row->thread!=event.thread){FailLocked(7);return false;}
        event.generation=row->generation;event.covered=row->covered && row->journalReset;
        const bool sourceEvent=event.kind==Kind::Targets || event.kind==Kind::Barrier || event.kind==Kind::Draw;
        if(sourceEvent && (!observed || event.role>=2 || !(*observed==sources_[event.role]))) {FailLocked(8);return false;}
        if(sourceEvent){event.source=observed->canonical;event.typedResource=observed->binding.resource;
            if(state_.phase==Phase::Collecting)row->watched=true;}
        switch(event.kind) {
        case Kind::Reset:
            ledger_.Reset(event.list,event.success);row->covered=event.success;
            row->journalReset=event.success && row->watched;
            if(event.success){++row->generation;if(row->watched)++state_.resets;}
            event.generation=row->generation;event.covered=row->covered && row->journalReset;break;
        case Kind::Close:ledger_.Close(event.list,event.success);row->covered=false;break;
        case Kind::Targets:ledger_.TargetsForSource(event.list,event.role,*observed);break;
        case Kind::ClearTargets:ledger_.ClearTargets(event.list);break;
        case Kind::Barrier:
            ledger_.BarrierForSource(event.list,event.role,*observed,event.before,event.afterState,event.whole);
            break;
        case Kind::Predication:ledger_.Predication(event.list,event.success);break;
        case Kind::Opaque:ledger_.Opaque(event.list);++state_.opaque;break;
        case Kind::Draw:
            // A matched native draw is an observation, not BeginDraw/CanCopy.
            break;
        default:FailLocked(9);return false;
        }
        const bool saved=row->watched && Store(event,event.kind==Kind::Reset || event.kind==Kind::Close);
        if(!saved)++state_.suppressed;
        if(saved && event.kind==Kind::Draw && event.covered && event.success)++state_.draws[event.role];
        if(saved && event.kind==Kind::Barrier && event.covered)++state_.transitions[event.role];
        return Finish(row,event);
    }
    // Barrier arrays are one native operation; all transitions retain its serial.
    bool Barriers(Event event,const unsigned* roles,const uint32_t* before,
                  const uint32_t* after,const bool* whole,unsigned count,bool opaque) {
        std::lock_guard lock(mutex_);auto* row=Find(event.list);
        if(state_.invalid || !row || row->operation!=event.serial || row->thread!=event.thread || count>64
            || (count && (!roles || !before || !after || !whole))){FailLocked(10);return false;}
        event.generation=row->generation;event.covered=row->covered && row->journalReset;
        if(count && state_.phase==Phase::Collecting)row->watched=true;
        if(opaque){ledger_.Opaque(event.list);event.kind=Kind::Opaque;++state_.opaque;
            if(row->watched)Store(event);else ++state_.suppressed;}
        for(unsigned i=0;i<count && !state_.invalid;++i) {
            if(roles[i]>=2){FailLocked(11);break;}
            event.kind=Kind::Barrier;event.role=roles[i];event.before=before[i];event.afterState=after[i];event.whole=whole[i];
            event.source=sources_[roles[i]].canonical;event.typedResource=sources_[roles[i]].binding.resource;
            ledger_.BarrierForSource(event.list,roles[i],sources_[roles[i]],before[i],after[i],whole[i]);
            if(Store(event)){if(event.covered)++state_.transitions[roles[i]];}else ++state_.suppressed;
        }
        return Finish(row,event);
    }
    bool EndUnreported(uintptr_t list,uint64_t serial,uint32_t thread) {
        std::lock_guard lock(mutex_);Event e;e.list=list;e.serial=serial;e.thread=thread;return Finish(Find(list),e);
    }
    bool Execution(Event event) {
        std::lock_guard lock(mutex_);
        if(state_.invalid || state_.phase==Phase::Unbound)return false;
        if((event.kind!=Kind::ExecuteBegin && event.kind!=Kind::ExecuteEnd) || !event.queue || !event.serial
            || !event.thread || !event.count || event.count>64){FailLocked(12);return false;}
        bool watched=false;
        for(unsigned i=0;i<event.count;++i) {
            if(!event.lists[i]){FailLocked(13);return false;}
            for(unsigned j=0;j<i;++j)if(event.lists[i]==event.lists[j]){FailLocked(14);return false;}
            const auto* row=Find(event.lists[i]);event.generations[i]=row?row->generation:0;
            watched=watched || (row && row->watched);
        }
        if(event.kind==Kind::ExecuteBegin) {
            Pending* free=nullptr;for(auto& p:pending_){if(p.used && p.event.serial==event.serial){FailLocked(15);return false;}if(!p.used)free=&p;}
            if(!free){FailLocked(16);return false;}*free={event,true,watched};
            if(watched)return Store(event,true);++state_.suppressed;return true;
        }
        Pending* found=nullptr;for(auto& p:pending_)if(p.used && p.event.serial==event.serial)found=&p;
        if(!found || !event.success || found->event.queue!=event.queue || found->event.typedObject!=event.typedObject
            || found->event.caller!=event.caller || found->event.thread!=event.thread || found->event.count!=event.count
            || found->event.lists!=event.lists || found->event.generations!=event.generations
            || found->event.nativeBatch!=event.nativeBatch){FailLocked(17);return false;}
        watched=found->watched;found->used=false;
        if(watched){++state_.executePairs;return Store(event,true);}++state_.suppressed;return true;
    }
    void Boundary(Event event){std::lock_guard lock(mutex_);event.kind=Kind::Boundary;Store(event);}
    void Cut(uint32_t counter) {
        std::lock_guard lock(mutex_);
        if(state_.phase==Phase::Collecting){state_.phase=Phase::Tail;state_.cutCounter=counter;
            Event event;event.kind=Kind::WindowEnd;event.counter=counter;Store(event,true);}
    }
    void Stop(){std::lock_guard lock(mutex_);for(const auto& p:pending_)if(p.used)FailLocked(18);
        for(unsigned i=0;i<state_.lists;++i)if(lists_[i].operation)FailLocked(19);state_.phase=Phase::Stopped;}
    void Fail(unsigned reason){std::lock_guard lock(mutex_);FailLocked(reason);}
    Status Get()const {std::lock_guard lock(mutex_);return state_;}
    SourceBinding Source(unsigned role)const {std::lock_guard lock(mutex_);return role<2?sources_[role]:SourceBinding{};}
    bool Read(unsigned index,Event& out)const {std::lock_guard lock(mutex_);if(index>=state_.records)return false;out=events_[index];return true;}
};
}
