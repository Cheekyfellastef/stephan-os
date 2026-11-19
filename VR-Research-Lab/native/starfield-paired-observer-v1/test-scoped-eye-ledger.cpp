#include "scoped-eye-ledger.h"
#include <cassert>
#include <cstdio>
#include <thread>
#include <atomic>
struct Ledger:eye_capture::ScopedLedger<32> {Ledger(){assert(BindSource(555));}};
Ledger::Ticket Begin(Ledger& m,uintptr_t id,uint32_t counter,unsigned eye,uint32_t thread,uint64_t serial) {
    if(!m.BeginOperation(id,serial,thread))return {};
    const auto ticket=m.BeginDraw(id,counter,eye,thread,serial,{101,102,103,104,105});
    if(!ticket.list)m.EndOperation(id,serial,thread);
    return ticket;
}
const Ledger::Binding bound{101,102,103,104,105};
void Local(Ledger& m,uintptr_t id) {m.Reset(id,true);m.Barrier(id,1024,4,true);m.Targets(id,bound);}
void Capture(Ledger& m,uintptr_t id,unsigned eye,uint64_t serial) {
    Local(m,id);auto t=Begin(m,id,9,eye,1,serial);assert(t.list && m.CanCopy(t,1));
    assert(m.Recorded(t,true));m.EndOperation(id,serial,1);m.Close(id,true);
}
void Submit(Ledger& m,uintptr_t id,uint64_t serial) {
    auto b=m.BeginSubmission(100,&id,1,true,serial);assert(b.valid && b.relevant && m.Submitted(b));
}
int main() {
    Ledger good;Capture(good,8,0,1);
    const uintptr_t eight[]={1,2,3,4,5,6,7,8};
    auto first=good.BeginSubmission(100,eight,8,true,2);assert(first.valid && first.relevant && good.Submitted(first));
    const uintptr_t other[]={20,21};assert(good.Submitted(good.BeginSubmission(200,other,2,false,3)));
    // Another valid writer may overwrite the shared source after the snapshot.
    Local(good,20);good.Opaque(20);good.Close(20,true);
    assert(good.Submitted(good.BeginSubmission(100,other,2,false,4)));
    Capture(good,9,1,5);Submit(good,9,6);assert(!good.ReadyForFence());
    good.Reset(8,true);good.Reset(9,true);assert(good.ReadyForFence());
    Ledger noState;noState.Reset(8,true);noState.Targets(8,bound);assert(!Begin(noState,8,9,0,1,1).list);
    Ledger inherited;Local(inherited,7);inherited.Close(7,true);inherited.Reset(8,true);inherited.Targets(8,bound);
    assert(!Begin(inherited,8,9,0,1,1).list); // State from another list is insufficient.
    Ledger split;Local(split,8);split.Barrier(8,4,128,false);split.Barrier(8,128,4,true);assert(!Begin(split,8,9,0,1,1).list);
    Ledger opaque;Local(opaque,8);opaque.Opaque(8);opaque.Barrier(8,4,128,true);opaque.Barrier(8,128,4,true);assert(!Begin(opaque,8,9,0,1,1).list);
    Ledger mismatched;Local(mismatched,8);mismatched.Barrier(8,128,4,true);assert(!Begin(mismatched,8,9,0,1,1).list);
    Ledger pred;Local(pred,8);pred.Predication(8,true);assert(!Begin(pred,8,9,0,1,1).list);pred.Predication(8,false);assert(Begin(pred,8,9,0,1,2).list);
    Ledger target;Local(target,8);target.Targets(8,{});assert(!Begin(target,8,9,0,1,1).list);
    Ledger lease;Local(lease,8);auto t=Begin(lease,8,9,0,1,1);assert(!lease.CanCopy(t,2));assert(!lease.BeginOperation(8,2,2));assert(!lease.CanCopy(t,1) && !lease.Recorded(t,true));
    Ledger resetRace;Local(resetRace,8);t=Begin(resetRace,8,9,0,1,1);resetRace.Reset(8,true);assert(resetRace.Get().invalid && !resetRace.CanCopy(t,1));
    Ledger closeRace;Local(closeRace,8);t=Begin(closeRace,8,9,0,1,1);closeRace.Close(8,true);assert(closeRace.Get().invalid && !closeRace.CanCopy(t,1));
    Ledger failedClose;Capture(failedClose,8,0,1);failedClose.Close(8,false);assert(failedClose.Get().invalid);
    Ledger noSubmit;Capture(noSubmit,8,0,1);noSubmit.Reset(8,true);assert(noSubmit.Get().invalid && !noSubmit.ReadyForFence());
    Ledger failedReset;Capture(failedReset,8,0,1);Submit(failedReset,8,2);failedReset.Reset(8,false);assert(failedReset.Get().invalid);
    Ledger wrongOrder;Capture(wrongOrder,8,0,1);const uintptr_t reversed[]={8,7};assert(!wrongOrder.BeginSubmission(100,reversed,2,true,2).valid);
    Ledger alias;Capture(alias,8,0,1);const uintptr_t duplicate[]={8,8};assert(!alias.BeginSubmission(100,duplicate,2,true,2).valid);
    Ledger foreign;Capture(foreign,8,0,1);const uintptr_t selected[]={8};assert(!foreign.BeginSubmission(100,selected,1,false,2).valid);
    Ledger replay;Capture(replay,8,0,1);Submit(replay,8,2);assert(!replay.BeginSubmission(100,selected,1,true,3).valid);
    Ledger queue;Capture(queue,8,0,1);Submit(queue,8,2);Capture(queue,9,1,3);const uintptr_t second[]={9};assert(!queue.BeginSubmission(101,second,1,true,4).valid);
    Ledger concurrent;Capture(concurrent,8,0,1);auto active=concurrent.BeginSubmission(100,selected,1,true,2);concurrent.Reset(8,true);assert(!concurrent.Submitted(active));
    Ledger counter;Capture(counter,8,0,1);Local(counter,9);assert(!Begin(counter,9,10,1,1,2).list);
    Ledger sameGeneration;Local(sameGeneration,8);t=Begin(sameGeneration,8,9,0,1,1);assert(sameGeneration.Recorded(t,true));sameGeneration.EndOperation(8,1,1);assert(!Begin(sameGeneration,8,9,1,1,2).list);
    Ledger racing;Local(racing,8);std::atomic<unsigned> wins{0};std::thread a([&]{if(Begin(racing,8,9,0,1,1).list)++wins;});
    std::thread b([&]{if(Begin(racing,8,9,0,2,2).list)++wins;});a.join();b.join();assert(wins==1);
    Ledger preReset;Local(preReset,8);assert(preReset.BeginOperation(8,1,1));
    assert(!preReset.BeginDraw(8,9,0,2,2,bound).list);preReset.Reset(8,true);preReset.EndOperation(8,1,1);
    Ledger sourceChange;Local(sourceChange,8);assert(!sourceChange.BindSource(556) && sourceChange.Get().invalid);
    eye_capture::ScopedLedger<4> unbound;unbound.Reset(8,true);assert(unbound.Get().lists==0 && !unbound.BeginOperation(8,1,1));
    Ledger receipt;Capture(receipt,8,0,1);auto forged=receipt.BeginSubmission(100,eight,8,true,2);forged.ids[0]=31;assert(!receipt.Submitted(forged));
    Ledger separate;Local(separate,8);Local(separate,9);assert(separate.BeginOperation(9,1,2));
    t=Begin(separate,8,9,0,1,2);assert(t.list && separate.CanCopy(t,1));
    assert(separate.Recorded(t,true));separate.EndOperation(8,2,1);separate.EndOperation(9,1,2);assert(!separate.Get().invalid);
    Ledger recycled;Local(recycled,8);auto changed=bound;changed.resource=999;recycled.Targets(8,changed);
    assert(!Begin(recycled,8,9,0,1,1).list); // Same numeric RTV, different actual bound resource.
    puts("Scoped snapshot ledger: local transition proof, draw lease, mixed-batch order/identity, alternate routes, replay, retirement and ambiguity rejection passed.");
}
