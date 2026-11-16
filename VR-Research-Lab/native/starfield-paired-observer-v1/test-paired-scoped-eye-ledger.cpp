#include "scoped-eye-ledger.h"
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <thread>

using Model=eye_capture::ScopedLedger<16>;
using Source=Model::SourceBinding;
constexpr Source primary{5001,{101,102,103,104,105}};
constexpr Source extra{5002,{201,202,203,204,205}};
constexpr std::array<Source,2> fixtureSources{primary,extra};
std::atomic<unsigned> checks{0};
unsigned cases=0;
const char* currentCase="setup";
void Check(bool result,const char* expression,int line) {
    ++checks;
    if(!result){std::fprintf(stderr,"FAIL %s line %d: %s\n",currentCase,line,expression);std::abort();}
}
#define CHECK(value) Check(bool(value),#value,__LINE__)
template<class F> void Case(const char* name,F test){currentCase=name;test();++cases;}
struct Paired:Model {Paired(){CHECK(BindPairedSources(fixtureSources));}};
void Prepare(Paired& m,uintptr_t list,unsigned eye,bool transition=true) {
    m.Reset(list,true);
    if(transition)m.BarrierForSource(list,eye,fixtureSources[eye],1024,4,true);
    m.TargetsForSource(list,eye,fixtureSources[eye]);
}
Model::Ticket Begin(Paired& m,uintptr_t list,unsigned eye,uint64_t serial=1,uint32_t counter=9,uint32_t thread=1) {
    if(!m.BeginOperation(list,serial,thread))return {};
    auto ticket=m.BeginDraw(list,counter,eye,thread,serial,fixtureSources[eye].binding);
    if(!ticket.list)m.EndOperation(list,serial,thread);
    return ticket;
}
Model::Ticket Record(Paired& m,uintptr_t list,unsigned eye,uint64_t serial) {
    Prepare(m,list,eye);auto ticket=Begin(m,list,eye,serial);
    CHECK(ticket.list && m.CanCopy(ticket,1));
    CHECK(m.Recorded(ticket,true));m.EndOperation(list,serial,1);m.Close(list,true);
    return ticket;
}
void Submit(Paired& m,uintptr_t list,uint64_t serial,uintptr_t queue=100) {
    auto receipt=m.BeginSubmission(queue,&list,1,true,serial);
    CHECK(receipt.valid && receipt.relevant && m.Submitted(receipt));
}
Source Change(Source source,unsigned field,uintptr_t value) {
    switch(field) {
    case 0:source.canonical=value;break;
    case 1:source.binding.wrapper=value;break;
    case 2:source.binding.context=value;break;
    case 3:source.binding.resource=value;break;
    case 4:source.binding.allocation=value;break;
    default:source.binding.handle=value;break;
    }
    return source;
}
uintptr_t Field(const Source& source,unsigned field) {
    switch(field) {
    case 0:return source.canonical;
    case 1:return source.binding.wrapper;
    case 2:return source.binding.context;
    case 3:return source.binding.resource;
    case 4:return source.binding.allocation;
    default:return source.binding.handle;
    }
}
int main() {
    Case("paired sources and recording retirement",[]{
        Paired m;CHECK(m.BindPairedSources(fixtureSources));
        const auto first=Record(m,8,0,1);CHECK(first.sourceCanonical==primary.canonical);
        CHECK(first.sourceCanonical!=first.binding.resource);Submit(m,8,2);
        const uintptr_t unrelated[]={30,31};
        CHECK(m.Submitted(m.BeginSubmission(200,unrelated,2,false,3)));
        const auto second=Record(m,9,1,4);CHECK(second.sourceCanonical==extra.canonical);Submit(m,9,5);
        CHECK(!m.ReadyForFence());m.Reset(8,true);CHECK(!m.ReadyForFence());
        m.Reset(9,true);CHECK(m.ReadyForFence() && !m.Get().invalid);
    });
    Case("other eye cannot lend its transition",[]{
        Paired m;Prepare(m,8,0,false);
        m.BarrierForSource(8,1,extra,1024,4,true);
        unsigned admissions=0;auto rejected=Begin(m,8,0);
        if(rejected.list && m.CanCopy(rejected,1))++admissions;
        CHECK(admissions==0 && !rejected.list && m.Get().rejectReasons[4]==1);
        m.BarrierForSource(8,0,primary,1024,4,true);
        auto valid=Begin(m,8,0,2);CHECK(valid.list && m.CanCopy(valid,1));
    });
    Case("primary cannot lend transition to extra",[]{
        Paired m;Record(m,7,0,1);Prepare(m,8,1,false);
        m.BarrierForSource(8,0,primary,1024,4,true);
        CHECK(!Begin(m,8,1,2).list);
        m.BarrierForSource(8,1,extra,1024,4,true);
        CHECK(Begin(m,8,1,3).list);
    });
    Case("another list cannot lend state",[]{
        Paired m;Prepare(m,7,0);Prepare(m,8,0,false);CHECK(!Begin(m,8,0).list);
    });
    Case("reset clears both source states",[]{
        Paired m;Prepare(m,8,0);m.BarrierForSource(8,1,extra,1024,4,true);
        m.Reset(8,true);m.TargetsForSource(8,0,primary);CHECK(!Begin(m,8,0).list);
    });
    Case("one current target replaces previous target",[]{
        Paired m;Prepare(m,8,0);m.BarrierForSource(8,1,extra,1024,4,true);
        m.TargetsForSource(8,1,extra);CHECK(!Begin(m,8,0).list);
        CHECK(m.Get().rejectReasons[6]==1);m.TargetsForSource(8,0,primary);
        CHECK(Begin(m,8,0,2).list);
    });
    Case("explicit target clear",[]{
        Paired m;Prepare(m,8,0);m.ClearTargets(8);CHECK(!Begin(m,8,0).list);
        m.TargetsForSource(8,0,primary);CHECK(Begin(m,8,0,2).list);
    });
    Case("changed observed source and typed binding",[]{
        for(unsigned field=0;field<6;++field) {
            Paired target;Prepare(target,8,0);target.TargetsForSource(8,0,Change(primary,field,9999));
            CHECK(target.Get().invalid && !Begin(target,8,0).list);
            Paired barrier;Prepare(barrier,8,0);barrier.BarrierForSource(8,0,Change(primary,field,9999),4,128,true);
            CHECK(barrier.Get().invalid && !Begin(barrier,8,0).list);
        }
    });
    Case("ambiguous or missing registration fields",[]{
        for(unsigned field=0;field<6;++field) {
            Model alias;auto pair=fixtureSources;pair[1]=Change(extra,field,Field(primary,field));
            CHECK(!alias.BindPairedSources(pair) && alias.Get().invalid);
            Model missing;pair=fixtureSources;pair[0]=Change(primary,field,0);
            CHECK(!missing.BindPairedSources(pair) && missing.Get().invalid);
        }
    });
    Case("wrong role and immutable registration",[]{
        Paired target;Prepare(target,8,0);target.TargetsForSource(8,0,extra);CHECK(target.Get().invalid);
        Paired barrier;Prepare(barrier,8,0);barrier.BarrierForSource(8,0,extra,4,128,true);CHECK(barrier.Get().invalid);
        Paired swapped;CHECK(!swapped.BindPairedSources({extra,primary}));
        CHECK(swapped.Get().invalid && !swapped.BindPairedSources(fixtureSources));
        Paired changed;auto pair=fixtureSources;pair[1].binding.handle=9999;
        CHECK(!changed.BindPairedSources(pair) && changed.Get().invalid);
    });
    Case("legacy paired API mixing fails closed",[]{
        Paired barrier;Prepare(barrier,8,0);barrier.Barrier(8,4,128,true);
        CHECK(barrier.Get().invalid && !Begin(barrier,8,0).list);
        Paired target;Prepare(target,8,0);target.Targets(8,primary.binding);
        CHECK(target.Get().invalid && !Begin(target,8,0).list);
        Paired clear;Prepare(clear,8,0);clear.Targets(8,{});CHECK(clear.Get().invalid);
        Paired paired;CHECK(!paired.BindSource(primary.canonical));
        Model shared;CHECK(shared.BindSource(primary.canonical));CHECK(!shared.BindPairedSources(fixtureSources));
        Model tagged;CHECK(tagged.BindSource(primary.canonical));tagged.Reset(8,true);
        tagged.BarrierForSource(8,0,primary,1024,4,true);CHECK(tagged.Get().invalid);
    });
    Case("invalid eye indices cannot index source arrays",[]{
        for(unsigned eye: {2u,std::numeric_limits<unsigned>::max()}) {
            Paired draw;Prepare(draw,8,0);CHECK(draw.BeginOperation(8,1,1));
            CHECK(!draw.BeginDraw(8,9,eye,1,1,primary.binding).list);draw.EndOperation(8,1,1);
            auto ticket=Model::Ticket{};ticket.eye=eye;CHECK(!draw.CanCopy(ticket,1));
            Paired barrier;barrier.BarrierForSource(8,eye,primary,1024,4,true);CHECK(barrier.Get().invalid);
            Paired target;target.TargetsForSource(8,eye,primary);CHECK(target.Get().invalid);
        }
    });
    Case("split inconsistent and opaque transitions",[]{
        for(unsigned fault=0;fault<3;++fault) {
            Paired m;Prepare(m,8,0);
            if(fault==0)m.BarrierForSource(8,0,primary,4,128,false);
            if(fault==1)m.BarrierForSource(8,0,primary,1024,128,true);
            if(fault==2)m.Opaque(8);
            m.BarrierForSource(8,0,primary,128,4,true);CHECK(!Begin(m,8,0).list);
        }
    });
    Case("predication remains disqualifying",[]{
        Paired m;Prepare(m,8,0);m.Predication(8,true);CHECK(!Begin(m,8,0).list);
        m.Predication(8,false);CHECK(Begin(m,8,0,2).list);
    });
    Case("forged ticket cannot borrow admission",[]{
        Paired m;Prepare(m,8,0);auto actual=Begin(m,8,0);CHECK(actual.list);
        for(unsigned field=0;field<8;++field) {
            auto fake=actual;
            switch(field) {
            case 0:fake.sourceCanonical=extra.canonical;break;
            case 1:fake.binding=extra.binding;break;
            case 2:fake.eye=1;break;
            case 3:++fake.generation;break;
            case 4:++fake.drawSerial;break;
            case 5:++fake.counter;break;
            case 6:++fake.thread;break;
            default:fake.list=9;break;
            }
            CHECK(!m.CanCopy(fake,1));
        }
        CHECK(m.CanCopy(actual,1));auto fake=actual;fake.sourceCanonical=extra.canonical;
        CHECK(!m.Recorded(fake,true) && m.Get().invalid && !m.CanCopy(actual,1));
    });
    Case("changes during a draw lease invalidate",[]{
        for(unsigned fault=0;fault<4;++fault) {
            Paired m;Prepare(m,8,0);auto ticket=Begin(m,8,0);CHECK(ticket.list);
            if(fault==0)m.TargetsForSource(8,1,extra);
            if(fault==1)m.ClearTargets(8);
            if(fault==2)m.Reset(8,true);
            if(fault==3)m.Close(8,true);
            CHECK(m.Get().invalid && !m.CanCopy(ticket,1));
        }
    });
    Case("counter and distinct recording generation remain required",[]{
        Paired counter;Record(counter,8,0,1);Prepare(counter,9,1);CHECK(!Begin(counter,9,1,2,10).list);
        Paired same;Prepare(same,8,0);auto ticket=Begin(same,8,0);CHECK(same.Recorded(ticket,true));same.EndOperation(8,1,1);
        same.BarrierForSource(8,1,extra,1024,4,true);same.TargetsForSource(8,1,extra);
        CHECK(!Begin(same,8,1,2).list && same.Get().rejectReasons[10]==1);
    });
    Case("forged relevant submission receipts fail",[]{
        for(unsigned field=0;field<6;++field) {
            Paired m;Record(m,8,0,1);const uintptr_t list=8;
            auto receipt=m.BeginSubmission(100,&list,1,true,2);CHECK(receipt.valid);
            switch(field) {
            case 0:++receipt.queue;break;
            case 1:++receipt.serial;break;
            case 2:++receipt.generation;break;
            case 3:receipt.eye=1;break;
            case 4:++receipt.count;break;
            default:receipt.ids[0]=9;break;
            }
            CHECK(!m.Submitted(receipt) && !m.ReadyForFence());
        }
    });
    Case("irrelevant flag cannot retire selected submission",[]{
        Paired m;Record(m,8,0,1);const uintptr_t list=8;auto actual=m.BeginSubmission(100,&list,1,true,2);
        CHECK(actual.valid);auto unrelated=actual;unrelated.relevant=false;
        CHECK(m.Submitted(unrelated));CHECK(!m.Get().eyes[0].submitted && !m.ReadyForFence());
        CHECK(m.Submitted(actual));CHECK(m.Get().eyes[0].submitted && !m.ReadyForFence());
    });
    Case("wrong tail duplicate identity and unverified batch",[]{
        for(unsigned fault=0;fault<3;++fault) {
            Paired m;Record(m,8,0,1);const uintptr_t wrongTail[]={8,7},duplicate[]={8,8},single[]={8};
            auto r=fault==0?m.BeginSubmission(100,wrongTail,2,true,2):fault==1?
                m.BeginSubmission(100,duplicate,2,true,2):m.BeginSubmission(100,single,1,false,2);
            CHECK(!r.valid && m.Get().invalid);
        }
    });
    Case("eye submission order queue and replay",[]{
        Paired order;Record(order,8,0,1);Record(order,9,1,2);const uintptr_t second=9;
        CHECK(!order.BeginSubmission(100,&second,1,true,3).valid);
        Paired queue;Record(queue,8,0,1);Submit(queue,8,2);Record(queue,9,1,3);
        CHECK(!queue.BeginSubmission(101,&second,1,true,4).valid);
        Paired replay;Record(replay,8,0,1);Submit(replay,8,2);const uintptr_t first=8;
        CHECK(!replay.BeginSubmission(100,&first,1,true,3).valid);
    });
    Case("retirement cannot precede actual submission",[]{
        Paired early;Record(early,8,0,1);early.Reset(8,true);CHECK(early.Get().invalid && !early.ReadyForFence());
        Paired active;Record(active,8,0,1);const uintptr_t first=8;auto r=active.BeginSubmission(100,&first,1,true,2);
        active.Reset(8,true);CHECK(!active.Submitted(r) && !active.ReadyForFence());
        Paired failed;Record(failed,8,0,1);Submit(failed,8,2);failed.Reset(8,false);
        CHECK(failed.Get().invalid && !failed.ReadyForFence());
    });
    Case("two selected lists cannot share one admitted batch",[]{
        Paired m;Record(m,8,0,1);Record(m,9,1,2);const uintptr_t both[]={8,9};
        CHECK(!m.BeginSubmission(100,both,2,true,3).valid && m.Get().invalid);
    });
    Case("deterministic overlap before draw admits neither",[]{
        Paired m;Prepare(m,8,0);CHECK(m.BeginOperation(8,1,1));
        std::thread contender([&]{CHECK(!m.BeginOperation(8,2,2));});contender.join();
        CHECK(!m.BeginDraw(8,9,0,1,1,primary.binding).list);m.EndOperation(8,1,1);
        CHECK(m.Get().invalid && !m.BindPairedSources(fixtureSources) && !m.BeginOperation(8,3,1));
    });
    Case("overlap after reservation revokes copy permission",[]{
        Paired m;Prepare(m,8,0);auto ticket=Begin(m,8,0);CHECK(ticket.list);
        std::thread contender([&]{CHECK(!m.BeginOperation(8,2,2));});contender.join();
        CHECK(!m.CanCopy(ticket,1) && !m.Recorded(ticket,true));m.EndOperation(8,1,1);
        CHECK(m.Get().invalid);
    });
    Case("independent lists retain independent operation ownership",[]{
        Paired m;Prepare(m,8,0);Prepare(m,9,1);CHECK(m.BeginOperation(9,2,2));
        auto ticket=Begin(m,8,0);CHECK(ticket.list && m.CanCopy(ticket,1));
        CHECK(m.Recorded(ticket,true));m.EndOperation(8,1,1);m.EndOperation(9,2,2);CHECK(!m.Get().invalid);
    });
    Case("capacity exhaustion remains terminal",[]{
        eye_capture::ScopedLedger<1> m;
        using SmallSource=eye_capture::ScopedLedger<1>::SourceBinding;
        const std::array<SmallSource,2> pair{{{5001,{101,102,103,104,105}},{5002,{201,202,203,204,205}}}};
        CHECK(m.BindPairedSources(pair));m.Reset(8,true);m.Reset(9,true);
        CHECK(m.Get().invalid && !m.BeginOperation(8,1,1) && !m.ReadyForFence());
    });
    std::printf("Paired scoped ledger: %u cases, %u checks PASS; portable admission model only.\n",cases,checks.load());
}
