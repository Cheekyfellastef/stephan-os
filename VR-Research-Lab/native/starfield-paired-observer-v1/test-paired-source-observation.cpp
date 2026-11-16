#include "paired-source-observation.h"
#include <atomic>
#include <cassert>
#include <cstdio>
#include <thread>
using M=paired_observation::Recorder<16,128,16>;
using K=paired_observation::Kind;
using S=M::SourceBinding;
const std::array<S,2> pair{{{1001,{11,12,13,14,15}},{2001,{21,22,23,24,25}}}};
unsigned checks=0;
void Check(bool value){++checks;assert(value);}
void Operation(M& m,K kind,uintptr_t list,uint64_t serial,unsigned role=2,bool success=true) {
    Check(m.Begin(list,serial,7));M::Event e;e.kind=kind;e.list=list;e.serial=serial;e.thread=7;e.counter=9;e.role=role;e.success=success;
    Check(m.Complete(e,role<2?&pair[role]:nullptr));
}
void WatchReset(M& m,uintptr_t list,uint64_t serial,unsigned role) {
    Operation(m,K::Targets,list,serial,role);Operation(m,K::Reset,list,serial+1);
}
M::Event Execution(uint64_t serial,uintptr_t list,K kind) {
    M::Event e;e.kind=kind;e.serial=serial;e.queue=800;e.typedObject=801;e.thread=7;e.count=1;e.lists[0]=list;e.success=true;e.nativeBatch=true;return e;
}
int main() {
    {M m;Check(!m.Begin(1,1,7));Check(!m.Get().invalid);Check(m.Bind(pair,9));Check(m.Source(0).canonical!=m.Source(0).binding.resource);
        auto bad=pair;bad[1].canonical=bad[0].canonical;Check(!m.Bind(bad,9));Check(m.Get().invalid);}
    {M m;auto bad=pair;bad[1].binding.resource=bad[0].binding.resource;Check(!m.Bind(bad,9));}
    {M m;Check(m.Bind(pair,9));auto swapped=pair;std::swap(swapped[0],swapped[1]);Check(!m.Bind(swapped,9));}
    {M m;Check(m.Bind(pair,9));Operation(m,K::Draw,10,1,0);Check(m.Get().draws[0]==0);
        WatchReset(m,10,2,0);Operation(m,K::Draw,10,4,0);Check(m.Get().draws[0]==1);
        Operation(m,K::Close,10,5);Operation(m,K::Draw,10,6,0);Check(m.Get().draws[0]==1);
        M::Event e;Check(m.Read(2,e));Check(!e.covered);}
    {M m;Check(m.Bind(pair,9));WatchReset(m,10,1,0);Check(m.Begin(10,3,7));
        M::Event e;e.list=10;e.serial=3;e.thread=7;unsigned roles[]={1};uint32_t before[]={1024},after[]={4};bool whole[]={true};
        Check(m.Barriers(e,roles,before,after,whole,1,false));Check(m.Get().transitions[0]==0 && m.Get().transitions[1]==1);
        Check(m.Begin(20,4,7));e.list=20;e.serial=4;roles[0]=0;Check(m.Barriers(e,roles,before,after,whole,1,false));Check(m.Get().transitions[0]==0);}
    {M m;Check(m.Bind(pair,9));WatchReset(m,10,1,0);Check(m.Begin(10,3,7));M::Event e;e.kind=K::Targets;e.list=10;e.serial=3;e.thread=7;e.role=0;
        S bad=pair[0];++bad.binding.context;Check(!m.Complete(e,&bad));Check(m.Get().invalid);}
    {M m;Check(m.Bind(pair,9));Check(m.Begin(10,3,7));Check(!m.EndUnreported(10,4,7));Check(m.Get().invalid);}
    {M m;Check(m.Bind(pair,9));Check(!m.Execution(Execution(1,10,K::ExecuteEnd)));Check(m.Get().executePairs==0);}
    {M m;Check(m.Bind(pair,9));WatchReset(m,10,1,0);auto e=Execution(3,10,K::ExecuteBegin);Check(m.Execution(e));e.kind=K::ExecuteEnd;e.queue=900;Check(!m.Execution(e));Check(m.Get().executePairs==0);}
    {M m;Check(m.Bind(pair,9));WatchReset(m,10,1,0);auto e=Execution(3,10,K::ExecuteBegin);Check(m.Execution(e));e.kind=K::ExecuteEnd;Check(m.Execution(e));Check(m.Get().executePairs==1);Check(!m.Execution(e));}
    {M m;Check(m.Bind(pair,9));WatchReset(m,10,1,0);auto e=Execution(3,10,K::ExecuteBegin);Check(m.Execution(e));Operation(m,K::Reset,10,4);e.kind=K::ExecuteEnd;Check(!m.Execution(e));}
    {M m;Check(m.Bind(pair,9));auto e=Execution(3,10,K::ExecuteBegin);e.count=2;e.lists[1]=10;Check(!m.Execution(e));}
    {M m;Check(m.Bind(pair,9));for(unsigned i=1;i<50;++i){Operation(m,K::Reset,10,i*2);Operation(m,K::ClearTargets,10,i*2+1);}Check(m.Get().records==2);Check(m.Get().suppressed==98);}
    {M m;Check(m.Bind(pair,9));WatchReset(m,10,1,0);m.Cut(15);const auto count=m.Get().records;Operation(m,K::Draw,10,3,0);Check(m.Get().records==count);Operation(m,K::Close,10,4);Check(m.Get().records==count+1);m.Stop();Check(!m.Get().invalid);Check(!m.Begin(10,5,7));}
    {M m;Check(m.Bind(pair,9));WatchReset(m,10,1,0);for(unsigned i=0;i<140 && !m.Get().invalid;++i){if(!m.Begin(10,10+i,7))break;M::Event e;e.kind=K::Reset;e.list=10;e.serial=10+i;e.thread=7;e.success=true;m.Complete(e);}Check(m.Get().invalid);Check(m.Get().dropped==1);Check(m.Get().records==128);}
    {M m;Check(m.Bind(pair,9));std::atomic<bool> started=false,overlap=false;bool first=false,second=true;
        std::thread a([&]{first=m.Begin(10,1,7);started.store(true);while(!overlap.load())std::this_thread::yield();m.EndUnreported(10,1,7);});
        std::thread b([&]{while(!started.load())std::this_thread::yield();second=m.Begin(10,2,8);overlap.store(true);});a.join();b.join();Check(first && !second);Check(m.Get().invalid);}
    {M m;Check(m.Bind(pair,9));Check(m.Begin(10,1,7));m.Stop();Check(m.Get().invalid);}
    printf("Paired source observation: 17 cases, %u checks PASS; observations only, no copy/submission/fence authority.\n",checks);
}
