export default class Input {

    constructor(surface = null){

        this.surface = null;
        this.touchOverlay = null;
        this.joystickBase = null;
        this.joystickKnob = null;

        this.joystickPointerId = null;
        this.activePointers = new Map();
        this.joystickCenter = { x: 0, y: 0 };
        this.joystickOffset = { x: 0, y: 0 };
        this.pointerFirePulse = false;

        this.deadZone = 12;
        this.maxRadius = 64;
        this.dragStartThreshold = 14;
        this.tapMaxDurationMs = 250;

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
        this.touchOverlay = surface.parentElement?.querySelector("[data-touch-overlay]") ?? null;
        this.joystickBase = this.touchOverlay?.querySelector("[data-joystick-base]") ?? null;
        this.joystickKnob = this.touchOverlay?.querySelector("[data-joystick-knob]") ?? null;

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

        this.resetPointerActions();
        this.surface = null;
        this.touchOverlay = null;
        this.joystickBase = null;
        this.joystickKnob = null;

    }

    update(){

        this.updateGamepad();
        this.sources.pointer.fire = this.pointerFirePulse;
        this.pointerFirePulse = false;
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

        if(!this.surface || !this.isPrimaryPointerButton(event)) return;

        const relativePoint = this.getRelativePoint(event);
        this.activePointers.set(event.pointerId, {
            startX: relativePoint.x,
            startY: relativePoint.y,
            x: relativePoint.x,
            y: relativePoint.y,
            startTime: performance.now(),
            movedPastTapThreshold: false
        });
        this.capturePointer(event.pointerId);
        this.preventPointerDefault(event);

    }

    onPointerMove(event){

        const pointerState = this.activePointers.get(event.pointerId);
        if(!pointerState) return;

        const relativePoint = this.getRelativePoint(event);
        pointerState.x = relativePoint.x;
        pointerState.y = relativePoint.y;

        const movedDistanceSquared =
            ((pointerState.x - pointerState.startX) ** 2) +
            ((pointerState.y - pointerState.startY) ** 2);

        if(movedDistanceSquared > this.dragStartThreshold ** 2){
            pointerState.movedPastTapThreshold = true;
        }

        // Rule: first pointer that crosses drag threshold claims joystick.
        if(
            this.joystickPointerId === null &&
            pointerState.movedPastTapThreshold
        ){
            this.joystickPointerId = event.pointerId;
            this.setJoystickCenter(pointerState.startX, pointerState.startY);
        }

        if(event.pointerId === this.joystickPointerId){
            this.updateJoystickFromPoint(relativePoint.x, relativePoint.y);
            this.preventPointerDefault(event);
        }

    }

    onPointerUp(event){

        this.releasePointerState(event.pointerId, event, false);

    }

    onPointerCancel(event){

        this.releasePointerState(event.pointerId, event, true);

    }

    releasePointerState(pointerId, event = null, canceled = false){

        const pointerState = this.activePointers.get(pointerId);

        if(pointerId === this.joystickPointerId){
            this.releaseCapturedPointer(pointerId);
            this.joystickPointerId = null;
            this.resetJoystickState();
        } else {
            this.releaseCapturedPointer(pointerId);
        }

        if(!canceled && this.isTapPointer(pointerState)){
            this.queueTapFire();
        }

        this.activePointers.delete(pointerId);
        this.preventPointerDefault(event);

    }

    isTapPointer(pointerState){

        if(!pointerState || pointerState.movedPastTapThreshold) return false;

        const elapsed = performance.now() - pointerState.startTime;
        return elapsed <= this.tapMaxDurationMs;

    }

    queueTapFire(){

        this.pointerFirePulse = true;
        this.sources.pointer.fire = true;
        this.syncActions();

    }

    capturePointer(pointerId){

        this.surface?.setPointerCapture?.(pointerId);

    }

    releaseCapturedPointer(pointerId){

        if(this.surface && this.surface.hasPointerCapture?.(pointerId)){
            this.surface.releasePointerCapture(pointerId);
        }

    }

    getRelativePoint(event){

        const rect = this.surface.getBoundingClientRect();

        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            width: rect.width,
            height: rect.height
        };

    }

    setJoystickCenter(x, y){

        this.joystickCenter.x = x;
        this.joystickCenter.y = y;
        this.joystickOffset.x = 0;
        this.joystickOffset.y = 0;
        this.renderJoystick();

    }

    updateJoystickFromPoint(x, y){

        const dx = x - this.joystickCenter.x;
        const clampedX = Math.max(-this.maxRadius, Math.min(this.maxRadius, dx));

        this.joystickOffset.x = clampedX;
        this.joystickOffset.y = 0;

        this.sources.pointer.moveLeft = clampedX < -this.deadZone;
        this.sources.pointer.moveRight = clampedX > this.deadZone;

        this.renderJoystick();
        this.syncActions();

    }

    renderJoystick(){

        if(!this.touchOverlay || !this.joystickBase || !this.joystickKnob) return;

        const active = this.joystickPointerId !== null;

        this.touchOverlay.dataset.joystickActive = active ? "true" : "false";
        this.touchOverlay.style.setProperty("--joystick-center-x", `${this.joystickCenter.x}px`);
        this.touchOverlay.style.setProperty("--joystick-center-y", `${this.joystickCenter.y}px`);
        this.touchOverlay.style.setProperty("--joystick-offset-x", `${this.joystickOffset.x}px`);
        this.touchOverlay.style.setProperty("--joystick-offset-y", `${this.joystickOffset.y}px`);

    }

    isPrimaryPointerButton(event){

        if(event.pointerType === "mouse"){
            return event.button === 0;
        }

        return true;

    }

    preventPointerDefault(event){

        if(event?.cancelable){
            event.preventDefault();
        }

    }

    resetJoystickState(){

        this.joystickOffset.x = 0;
        this.joystickOffset.y = 0;
        this.sources.pointer.moveLeft = false;
        this.sources.pointer.moveRight = false;
        this.renderJoystick();
        this.syncActions();

    }

    resetPointerActions(){

        if(this.joystickPointerId !== null){
            this.releaseCapturedPointer(this.joystickPointerId);
        }

        this.joystickPointerId = null;
        this.activePointers.clear();
        this.joystickCenter.x = 0;
        this.joystickCenter.y = 0;
        this.joystickOffset.x = 0;
        this.joystickOffset.y = 0;
        this.pointerFirePulse = false;

        this.sources.pointer.moveLeft = false;
        this.sources.pointer.moveRight = false;
        this.sources.pointer.fire = false;

        if(this.touchOverlay){
            this.touchOverlay.dataset.joystickActive = "false";
            this.touchOverlay.style.removeProperty("--joystick-center-x");
            this.touchOverlay.style.removeProperty("--joystick-center-y");
            this.touchOverlay.style.removeProperty("--joystick-offset-x");
            this.touchOverlay.style.removeProperty("--joystick-offset-y");
        }

        this.syncActions();

    }

    resetAllActions(){

        Object.values(this.sources).forEach((source) => {
            source.moveLeft = false;
            source.moveRight = false;
            source.fire = false;
        });

        this.resetPointerActions();
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
