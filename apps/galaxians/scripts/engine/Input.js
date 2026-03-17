export default class Input {

    constructor(){

        this.left = false;
        this.right = false;
        this.fire = false;

    }

    update(){

        const gamepads = navigator.getGamepads();

        if(!gamepads[0]) return;

        const gp = gamepads[0];

        const axis = gp.axes[0];

        this.left = axis < -0.3;
        this.right = axis > 0.3;

        this.fire = gp.buttons[0].pressed;

    }

}