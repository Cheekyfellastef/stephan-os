export default class Input {

    constructor(surface = null){

        this.surface = null;
        this.pointerId = null;

        this.sources = {
            keyboard: { moveLeft: false, moveRight: false, fire: false },
            gamepad: { moveLeft: false, moveRight: false, fire: false },
            pointer: { moveLeft: false, moveRight: false, fire: false }
        };

        this.left = false;
        this.right = false;
        this.fire = false;

        this.boundKeyDown = this.onKeyDown.bind(this);
        this.boundKeyUp = this.onKeyUp.bind(this);
        this.boundPointerDown = this.onPointerDown.bind(this);
        this.boundPointerMove = this.onPointerMove.bind(this);
        this.boundPointerUp = this.onPointerUp.bind(this);
        this.boundPointerCancel = this.onPointerCancel.bind(this);
        this.boundVisibilityChange = this.onVisibilityChange.bind(this);
        this.boundWindowBlur = this.onWindowBlur.bind(this);

        window.addEventListener("keydown", this.boundKeyDown);
        window.addEventListener("keyup", this.boundKeyUp);
        window.addEventListener("blur", this.boundWindowBlur);
        document.addEventListener("visibilitychange", this.boundVisibilityChange);

        if(surface){
            this.bindSurface(surface);
        }

    }

    bindSurface(surface){

        if(this.surface === surface) return;

        if(this.surface){
            this.unbindSurface();
        }

        this.surface = surface;

        this.surface.addEventListener("pointerdown", this.boundPointerDown);
        this.surface.addEventListener("pointermove", this.boundPointerMove);
        this.surface.addEventListener("pointerup", this.boundPointerUp);
        this.surface.addEventListener("pointercancel", this.boundPointerCancel);
        this.surface.addEventListener("lostpointercapture", this.boundPointerCancel);

    }

    unbindSurface(){

        if(!this.surface) return;

        this.surface.removeEventListener("pointerdown", this.boundPointerDown);
        this.surface.removeEventListener("pointermove", this.boundPointerMove);
        this.surface.removeEventListener("pointerup", this.boundPointerUp);
        this.surface.removeEventListener("pointercancel", this.boundPointerCancel);
        this.surface.removeEventListener("lostpointercapture", this.boundPointerCancel);

        this.surface = null;
        this.pointerId = null;
        this.resetPointerActions();

    }

    update(){

        this.updateGamepad();
        this.syncActions();

    }

    updateGamepad(){

        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = gamepads?.[0];

        if(!gp){
            this.sources.gamepad.moveLeft = false;
            this.sources.gamepad.moveRight = false;
            this.sources.gamepad.fire = false;
            return;
        }

        const axis = gp.axes?.[0] ?? 0;

        this.sources.gamepad.moveLeft = axis < -0.3;
        this.sources.gamepad.moveRight = axis > 0.3;
        this.sources.gamepad.fire = !!gp.buttons?.[0]?.pressed;

    }

    onKeyDown(event){

        if(event.repeat) return;

        if(this.applyKeyboardAction(event.code, true)){
            event.preventDefault();
        }

    }

    onKeyUp(event){

        if(this.applyKeyboardAction(event.code, false)){
            event.preventDefault();
        }

    }

    applyKeyboardAction(code, pressed){

        switch(code){
            case "ArrowLeft":
            case "KeyA":
                this.sources.keyboard.moveLeft = pressed;
                return true;
            case "ArrowRight":
            case "KeyD":
                this.sources.keyboard.moveRight = pressed;
                return true;
            case "Space":
            case "KeyW":
            case "ArrowUp":
                this.sources.keyboard.fire = pressed;
                return true;
            default:
                return false;
        }

    }

    onPointerDown(event){

        if(!this.surface) return;

        if(this.pointerId !== null && this.pointerId !== event.pointerId){
            return;
        }

        this.pointerId = event.pointerId;
        this.surface.setPointerCapture?.(event.pointerId);
        this.updatePointerFromEvent(event);
        this.preventPointerDefault(event);

    }

    onPointerMove(event){

        if(event.pointerId !== this.pointerId) return;

        this.updatePointerFromEvent(event);
        this.preventPointerDefault(event);

    }

    onPointerUp(event){

        if(event.pointerId !== this.pointerId) return;

        this.releasePointer(event);

    }

    onPointerCancel(event){

        if(this.pointerId !== null && event.pointerId !== undefined && event.pointerId !== this.pointerId) return;

        this.releasePointer(event);

    }

    releasePointer(event){

        if(this.surface && event?.pointerId !== undefined && this.surface.hasPointerCapture?.(event.pointerId)){
            this.surface.releasePointerCapture(event.pointerId);
        }

        this.pointerId = null;
        this.resetPointerActions();
        this.preventPointerDefault(event);

    }

    updatePointerFromEvent(event){

        const rect = this.surface.getBoundingClientRect();
        const relativeX = event.clientX - rect.left;
        const zone = relativeX / rect.width;

        this.sources.pointer.moveLeft = zone < 0.35;
        this.sources.pointer.moveRight = zone > 0.65;
        this.sources.pointer.fire = zone >= 0.35 && zone <= 0.65;

        if(event.pointerType === "mouse"){
            this.sources.pointer.fire = event.buttons === 1 && this.sources.pointer.fire;
        }

    }

    preventPointerDefault(event){

        if(event?.cancelable){
            event.preventDefault();
        }

    }

    resetPointerActions(){

        this.sources.pointer.moveLeft = false;
        this.sources.pointer.moveRight = false;
        this.sources.pointer.fire = false;
        this.syncActions();

    }

    resetAllActions(){

        Object.values(this.sources).forEach((source) => {
            source.moveLeft = false;
            source.moveRight = false;
            source.fire = false;
        });

        this.pointerId = null;
        this.syncActions();

    }

    onVisibilityChange(){

        if(document.hidden){
            this.resetAllActions();
        }

    }

    onWindowBlur(){

        this.resetAllActions();

    }

    syncActions(){

        this.left = this.sources.keyboard.moveLeft || this.sources.gamepad.moveLeft || this.sources.pointer.moveLeft;
        this.right = this.sources.keyboard.moveRight || this.sources.gamepad.moveRight || this.sources.pointer.moveRight;
        this.fire = this.sources.keyboard.fire || this.sources.gamepad.fire || this.sources.pointer.fire;

    }

    destroy(){

        window.removeEventListener("keydown", this.boundKeyDown);
        window.removeEventListener("keyup", this.boundKeyUp);
        window.removeEventListener("blur", this.boundWindowBlur);
        document.removeEventListener("visibilitychange", this.boundVisibilityChange);
        this.unbindSurface();
        this.resetAllActions();

    }

}
