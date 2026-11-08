#define NOMINMAX
#include <windows.h>
#include <dwmapi.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wincodec.h>
#include <wincrypt.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <winrt/Windows.Data.Json.h>
#include <iostream>
#include <mutex>
#include <chrono>
#include <vector>
#include <string>
#include <cmath>
#include <memory>
#include <utility>
using namespace winrt;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
using namespace winrt::Windows::Graphics::DirectX::Direct3D11;
using namespace winrt::Windows::Data::Json;
using Clock=std::chrono::steady_clock;
constexpr bool CaptureSizeValid(int width,int height){return width>0&&height>0&&width<=8192&&height<=8192;}
constexpr bool CaptureCopyFits(int width,int height,UINT textureWidth,UINT textureHeight,UINT rowPitch){
  return CaptureSizeValid(width,height)&&(UINT)width<=textureWidth&&(UINT)height<=textureHeight&&rowPitch>=(UINT)width*4;
}
// Compile-time boundary regressions also run in every production native build.
static_assert(CaptureCopyFits(8192,8192,8192,8192,32768));
static_assert(CaptureCopyFits(640,480,1920,1080,7680));
static_assert(!CaptureCopyFits(0,480,1920,1080,7680)&&!CaptureCopyFits(640,-1,1920,1080,7680));
static_assert(!CaptureCopyFits(8193,480,16384,1080,65536)&&!CaptureCopyFits(640,8193,1920,16384,7680));
static_assert(!CaptureCopyFits(1920,1080,640,1080,7680)&&!CaptureCopyFits(1920,1080,1920,480,7680));
static_assert(!CaptureCopyFits(640,480,640,480,2559));
static JsonObject Reply(const wchar_t* status){JsonObject o;o.SetNamedValue(L"status",JsonValue::CreateStringValue(status));return o;}
static void Str(JsonObject& o,const wchar_t* key,std::wstring const& value){o.SetNamedValue(key,JsonValue::CreateStringValue(value));}
static void Num(JsonObject& o,const wchar_t* key,double value){o.SetNamedValue(key,JsonValue::CreateNumberValue(value));}
static std::wstring Title(HWND w){wchar_t title[512]{};GetWindowTextW(w,title,512);return title;}
static bool RootWindow(HWND w){return IsWindow(w)&&IsWindowVisible(w)&&GetAncestor(w,GA_ROOT)==w;}
static bool SelectableWindow(HWND w){DWORD cloaked=0;DwmGetWindowAttribute(w,DWMWA_CLOAKED,&cloaked,sizeof(cloaked));const auto style=GetWindowLongPtrW(w,GWL_EXSTYLE);return RootWindow(w)&&w!=GetShellWindow()&&!cloaked&&!(style&(WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE));}
static void Post(HWND w,UINT message,WPARAM wp,LPARAM lp){if(!PostMessageW(w,message,wp,lp))throw std::runtime_error("Window rejected input");}
static std::string Base64(std::vector<BYTE> const& data){DWORD n=0;CryptBinaryToStringA(data.data(),(DWORD)data.size(),CRYPT_STRING_BASE64|CRYPT_STRING_NOCRLF,nullptr,&n);std::string s(n,'\0');CryptBinaryToStringA(data.data(),(DWORD)data.size(),CRYPT_STRING_BASE64|CRYPT_STRING_NOCRLF,s.data(),&n);s.resize(n);return s;}
static unsigned long long ProcessBirth(DWORD pid){HANDLE p=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid);if(!p)return 0;FILETIME start,stop,kernel,user;bool ok=GetProcessTimes(p,&start,&stop,&kernel,&user)!=0;CloseHandle(p);return ok?((unsigned long long)start.dwHighDateTime<<32)|start.dwLowDateTime:0;}
struct Surface : std::enable_shared_from_this<Surface> {
  HWND root{},target{},inputChild{};DWORD pid{};unsigned long long birth{};
  GraphicsCaptureItem item{nullptr};Direct3D11CaptureFramePool pool{nullptr};GraphicsCaptureSession session{nullptr};
  com_ptr<ID3D11Device> device;com_ptr<ID3D11DeviceContext> context;IDirect3DDevice direct{nullptr};
  com_ptr<IWICImagingFactory> wic;std::mutex mutex;std::string jpeg;int width{},height{};
  RECT bounds{};uint64_t generation=0,serial=0,captureEpoch=0;Clock::time_point captured{},encoded{};bool closed=false;
  void InitGraphics(){
    check_hresult(D3D11CreateDevice(nullptr,D3D_DRIVER_TYPE_HARDWARE,nullptr,D3D11_CREATE_DEVICE_BGRA_SUPPORT,nullptr,0,D3D11_SDK_VERSION,device.put(),nullptr,context.put()));
    auto dxgi=device.as<IDXGIDevice>();com_ptr<IInspectable> inspect;check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgi.get(),inspect.put()));direct=inspect.as<IDirect3DDevice>();
    check_hresult(CoCreateInstance(CLSID_WICImagingFactory,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(wic.put())));
  }
  ~Surface(){Stop();}
  void CloseCapture(){
    GraphicsCaptureSession oldSession{nullptr};Direct3D11CaptureFramePool oldPool{nullptr};
    {std::lock_guard lock(mutex);closed=true;captureEpoch++;generation++;jpeg.clear();oldSession=std::exchange(session,nullptr);oldPool=std::exchange(pool,nullptr);item=nullptr;}
    if(oldSession)oldSession.Close();if(oldPool)oldPool.Close();
  }
  void Stop(){CloseCapture();std::lock_guard lock(mutex);root=nullptr;target=nullptr;inputChild=nullptr;}
  bool Identity(){DWORD current=0;GetWindowThreadProcessId(root,&current);return RootWindow(root)&&current==pid&&birth&&birth==ProcessBirth(pid);}
  bool TargetValid(){DWORD cloaked=0;DwmGetWindowAttribute(target,DWMWA_CLOAKED,&cloaked,sizeof(cloaked));return !cloaked&&Identity()&&(target==root||GetAncestor(target,GA_ROOTOWNER)==root)&&RootWindow(target);}
  void Bind(HWND w,DWORD expected){
    Stop();DWORD current=0;GetWindowThreadProcessId(w,&current);
    if(!SelectableWindow(w)||current!=expected||IsIconic(w))throw std::runtime_error("Window is no longer available");
    const auto identity=ProcessBirth(current);
    const auto prompt=L"Allow the Spatial Workspace to view and control this window?\n\n"+Title(w)+L"\n\nOnly your console pointer and keyboard actions are forwarded. Audio stays in the original app. Disconnect in the workspace to stop.";
    if(MessageBoxW(nullptr,prompt.c_str(),L"Stephanos Spatial Console",MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2|MB_TOPMOST)!=IDYES)throw std::runtime_error("Operator declined");
    DWORD after=0;GetWindowThreadProcessId(w,&after);
    if(!RootWindow(w)||after!=expected||!identity||identity!=ProcessBirth(after))throw std::runtime_error("Window changed during consent");
    root=w;pid=current;birth=ProcessBirth(pid);if(!birth)throw std::runtime_error("Process unavailable");StartTarget(root);
  }
  void StartTarget(HWND w){
    if(!device)InitGraphics();
    CloseCapture();
    std::lock_guard lock(mutex);target=w;inputChild=nullptr;jpeg.clear();closed=false;generation++;
    auto factory=get_activation_factory<GraphicsCaptureItem,IGraphicsCaptureItemInterop>();
    check_hresult(factory->CreateForWindow(w,guid_of<GraphicsCaptureItem>(),put_abi(item)));
    const auto size=item.Size();if(!CaptureSizeValid(size.Width,size.Height))throw std::runtime_error("Invalid window size");
    width=size.Width;height=size.Height;
    pool=Direct3D11CaptureFramePool::CreateFreeThreaded(direct,DirectXPixelFormat::B8G8R8A8UIntNormalized,2,size);
    const auto weak=weak_from_this();const auto expected=captureEpoch;
    item.Closed([weak,expected](auto const&,auto const&){if(auto self=weak.lock()){std::lock_guard lock(self->mutex);if(self->captureEpoch==expected){self->closed=true;self->jpeg.clear();self->generation++;}}});
    pool.FrameArrived([weak,expected](auto const& sender,auto const&){if(auto self=weak.lock())self->Capture(sender,expected);});
    session=pool.CreateCaptureSession(item);session.StartCapture();
  }
  void Capture(Direct3D11CaptureFramePool const& sender,uint64_t expected){
    try{
      auto frame=sender.TryGetNextFrame();if(!frame)return;
      auto size=frame.ContentSize();std::lock_guard lock(mutex);
      if(closed||captureEpoch!=expected)return;
      if(!target||!TargetValid()||IsIconic(target)){jpeg.clear();return;}
      if(!CaptureSizeValid(size.Width,size.Height)){jpeg.clear();generation++;return;}
      if(size.Width!=width||size.Height!=height){
        jpeg.clear();generation++;frame.Close();
        sender.Recreate(direct,DirectXPixelFormat::B8G8R8A8UIntNormalized,2,size);
        width=size.Width;height=size.Height;
        return;
      }
      if(Clock::now()-encoded<std::chrono::milliseconds(66))return;
      auto access=frame.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();com_ptr<ID3D11Texture2D> texture;
      check_hresult(access->GetInterface(IID_PPV_ARGS(texture.put())));D3D11_TEXTURE2D_DESC desc{};texture->GetDesc(&desc);
      if(desc.Format!=DXGI_FORMAT_B8G8R8A8_UNORM||desc.Width<(UINT)width||desc.Height<(UINT)height)throw std::runtime_error("Capture texture is smaller than its content");
      desc.Usage=D3D11_USAGE_STAGING;desc.BindFlags=0;desc.MiscFlags=0;desc.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
      com_ptr<ID3D11Texture2D> staging;check_hresult(device->CreateTexture2D(&desc,nullptr,staging.put()));context->CopyResource(staging.get(),texture.get());
      std::vector<BYTE> pixels((size_t)width*height*4);
      D3D11_MAPPED_SUBRESOURCE mapped{};check_hresult(context->Map(staging.get(),0,D3D11_MAP_READ,0,&mapped));
      if(!mapped.pData||!CaptureCopyFits(width,height,desc.Width,desc.Height,mapped.RowPitch)){context->Unmap(staging.get(),0);throw std::runtime_error("Capture copy extent is invalid");}
      for(int y=0;y<height;y++)memcpy(pixels.data()+(size_t)y*width*4,(BYTE*)mapped.pData+(size_t)y*mapped.RowPitch,(size_t)width*4);
      context->Unmap(staging.get(),0);
      com_ptr<IWICBitmap> bitmap;check_hresult(wic->CreateBitmapFromMemory(width,height,GUID_WICPixelFormat32bppBGRA,width*4,(UINT)pixels.size(),pixels.data(),bitmap.put()));
      com_ptr<IStream> output;check_hresult(CreateStreamOnHGlobal(nullptr,TRUE,output.put()));
      com_ptr<IWICBitmapEncoder> encoder;check_hresult(wic->CreateEncoder(GUID_ContainerFormatJpeg,nullptr,encoder.put()));check_hresult(encoder->Initialize(output.get(),WICBitmapEncoderNoCache));
      com_ptr<IWICBitmapFrameEncode> image;com_ptr<IPropertyBag2> options;check_hresult(encoder->CreateNewFrame(image.put(),options.put()));
      PROPBAG2 option{};option.pstrName=const_cast<wchar_t*>(L"ImageQuality");VARIANT quality{};quality.vt=VT_R4;quality.fltVal=0.88f;options->Write(1,&option,&quality);
      check_hresult(image->Initialize(options.get()));check_hresult(image->SetSize(width,height));auto format=GUID_WICPixelFormat24bppBGR;check_hresult(image->SetPixelFormat(&format));
      check_hresult(image->WriteSource(bitmap.get(),nullptr));check_hresult(image->Commit());check_hresult(encoder->Commit());
      STATSTG info{};check_hresult(output->Stat(&info,STATFLAG_NONAME));if(info.cbSize.QuadPart>12*1024*1024)throw std::runtime_error("Frame too large");
      LARGE_INTEGER zero{};output->Seek(zero,STREAM_SEEK_SET,nullptr);std::vector<BYTE> bytes((size_t)info.cbSize.QuadPart);ULONG read{};check_hresult(output->Read(bytes.data(),(ULONG)bytes.size(),&read));
      if(read!=bytes.size())throw std::runtime_error("Frame incomplete");
      RECT next{};check_hresult(DwmGetWindowAttribute(target,DWMWA_EXTENDED_FRAME_BOUNDS,&next,sizeof(next)));
      if(memcmp(&bounds,&next,sizeof(next))!=0){bounds=next;generation++;}
      jpeg=Base64(bytes);captured=encoded=Clock::now();serial++;
    }catch(...){std::lock_guard lock(mutex);if(captureEpoch==expected)jpeg.clear();}
  }
  void RefreshPopup(){
    if(!Identity())throw std::runtime_error("Window closed");
    HWND popup=GetLastActivePopup(root);HWND next=RootWindow(popup)&&GetAncestor(popup,GA_ROOTOWNER)==root?popup:root;
    if(next!=target)StartTarget(next);
  }
  JsonObject Frame(){
    RefreshPopup();std::lock_guard lock(mutex);
    // WGC emits frames on content changes; a still window is not a lost stream.
    if(closed||jpeg.empty()||!TargetValid()||IsIconic(target))return Reply(L"waiting");
    auto o=Reply(L"frame");Str(o,L"jpeg",to_hstring(jpeg).c_str());Num(o,L"width",width);Num(o,L"height",height);Num(o,L"generation",(double)generation);Num(o,L"serial",(double)serial);return o;
  }
  JsonObject Input(JsonObject const& command){
    RefreshPopup();
    std::lock_guard lock(mutex);
    if(closed||!TargetValid()||IsIconic(target)||jpeg.empty()||command.GetNamedNumber(L"generation",-1)!=generation)throw std::runtime_error("Surface changed; refresh before input");
    RECT current{};check_hresult(DwmGetWindowAttribute(target,DWMWA_EXTENDED_FRAME_BOUNDS,&current,sizeof(current)));
    if(memcmp(&bounds,&current,sizeof(current))!=0)throw std::runtime_error("Window moved; refresh before input");
    auto kind=command.GetNamedString(L"kind",L"");
    if(kind==L"click"||kind==L"scroll"){
      auto x=command.GetNamedNumber(L"x",-1),y=command.GetNamedNumber(L"y",-1);
      if(!std::isfinite(x)||!std::isfinite(y)||x<0||x>1||y<0||y>1)throw std::runtime_error("Invalid point");
      POINT screen{bounds.left+(LONG)(x*(bounds.right-bounds.left-1)),bounds.top+(LONG)(y*(bounds.bottom-bounds.top-1))};
      POINT point=screen;ScreenToClient(target,&point);RECT client{};GetClientRect(target,&client);
      if(!PtInRect(&client,point))throw std::runtime_error("Only window content is interactive");
      HWND child=target;
      for(int depth=0;depth<16;depth++){
        POINT local=screen;ScreenToClient(child,&local);auto next=ChildWindowFromPointEx(child,local,CWP_SKIPINVISIBLE|CWP_SKIPDISABLED|CWP_SKIPTRANSPARENT);
        if(!next||next==child)break;child=next;
      }
      if(child!=target&&!IsChild(target,child))throw std::runtime_error("Input target changed");
      inputChild=child;POINT local=screen;ScreenToClient(child,&local);
      if(kind==L"click"){
        Post(child,WM_MOUSEMOVE,0,MAKELPARAM(local.x,local.y));
        Post(child,WM_LBUTTONDOWN,MK_LBUTTON,MAKELPARAM(local.x,local.y));
        Post(child,WM_LBUTTONUP,0,MAKELPARAM(local.x,local.y));
      }else{
        const auto delta=command.GetNamedNumber(L"delta",0);if(delta!=-120&&delta!=120)throw std::runtime_error("Invalid scroll");
        Post(child,WM_MOUSEWHEEL,MAKEWPARAM(0,(SHORT)delta),MAKELPARAM(screen.x,screen.y));
      }
    }else{
      HWND child=inputChild;
      GUITHREADINFO gui{sizeof(gui)};auto thread=GetWindowThreadProcessId(target,nullptr);
      if(GetGUIThreadInfo(thread,&gui)&&gui.hwndFocus&&(gui.hwndFocus==target||IsChild(target,gui.hwndFocus)))child=gui.hwndFocus;
      if(!child||(child!=target&&!IsChild(target,child)))throw std::runtime_error("Select a text field first");
      if(kind==L"text"){
        auto text=command.GetNamedString(L"text",L"");if(text.empty()||text.size()>256)throw std::runtime_error("Invalid text length");
        for(auto ch:text){if(ch<32||ch==127)throw std::runtime_error("Control character rejected");}
        for(auto ch:text)Post(child,WM_CHAR,ch,1);
      }else if(kind==L"key"){
        auto name=command.GetNamedString(L"key",L"");UINT key=name==L"Enter"?VK_RETURN:name==L"Backspace"?VK_BACK:name==L"Tab"?VK_TAB:name==L"Escape"?VK_ESCAPE:name==L"Left"?VK_LEFT:name==L"Right"?VK_RIGHT:0;
        if(!key)throw std::runtime_error("Key not supported");
        auto scan=MapVirtualKeyW(key,MAPVK_VK_TO_VSC);Post(child,WM_KEYDOWN,key,1|(scan<<16));
        Post(child,WM_KEYUP,key,1|(scan<<16)|(3u<<30));
      }else throw std::runtime_error("Input operation rejected");
    }
    return Reply(L"input-posted");
  }
};
int main(){
  init_apartment(apartment_type::multi_threaded);SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  try{
    auto surface=std::make_shared<Surface>();std::string line;
    while(std::getline(std::cin,line)){
      JsonObject reply;try{
        if(line.size()>4096)throw std::runtime_error("Request too large");auto command=JsonObject::Parse(to_hstring(line));auto op=command.GetNamedString(L"op",L"");
        if(op==L"list"){
          JsonArray windows;
          EnumWindows([](HWND w,LPARAM param)->BOOL{
            if(SelectableWindow(w)&&!Title(w).empty()){
              DWORD pid=0;GetWindowThreadProcessId(w,&pid);if(pid==GetCurrentProcessId()||!ProcessBirth(pid))return TRUE;
              auto o=Reply(L"window");Num(o,L"id",(double)(uintptr_t)w);Num(o,L"pid",pid);Str(o,L"title",Title(w));reinterpret_cast<JsonArray*>(param)->Append(o);
            }return TRUE;
          },(LPARAM)&windows);reply=Reply(L"windows");reply.SetNamedValue(L"windows",windows);
        }else if(op==L"bind"){
          auto handle=command.GetNamedNumber(L"id",0),pid=command.GetNamedNumber(L"pid",0);
          if(!std::isfinite(handle)||handle!=std::floor(handle)||handle<1||handle>9007199254740991.0||!std::isfinite(pid)||pid!=std::floor(pid)||pid<1||pid>MAXDWORD)throw std::runtime_error("Invalid window identity");
          surface->Bind((HWND)(uintptr_t)handle,(DWORD)pid);reply=Reply(L"connected");
        }else if(op==L"frame")reply=surface->Frame();
        else if(op==L"input")reply=surface->Input(command);
        else if(op==L"stop"){surface->Stop();reply=Reply(L"stopped");}
        else throw std::runtime_error("Operation rejected");
      }catch(...){reply=Reply(L"unavailable");}
      std::cout<<to_string(reply.Stringify())<<std::endl;
    }
  }catch(...){std::cout<<"{\"status\":\"capture-unavailable\"}"<<std::endl;return 1;}
}
