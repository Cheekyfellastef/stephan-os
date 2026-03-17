export default class GameLoop {

    constructor(update, render){
        this.update = update;
        this.render = render;
        this.lastTime = 0;
    }

    start(){
        requestAnimationFrame(this.loop.bind(this));
    }

    loop(time){

        const delta = (time - this.lastTime) / 1000;
        this.lastTime = time;

        this.update(delta);
        this.render();

        requestAnimationFrame(this.loop.bind(this));
    }

}