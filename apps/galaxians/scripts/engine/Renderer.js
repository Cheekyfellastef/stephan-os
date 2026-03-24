import Config from "../game/Config.js";
import Scaler from "./Scaler.js";

export default class Renderer {

    constructor(canvas){

        this.canvas = canvas;

        canvas.width = Config.baseWidth;
        canvas.height = Config.baseHeight;

        this.ctx = canvas.getContext("2d");

        this.ctx.imageSmoothingEnabled = false;

        this.boundResize = () => {
            Scaler.apply(canvas, Config.baseWidth, Config.baseHeight);
        };

        this.boundResize();

        window.addEventListener("resize", this.boundResize);
        window.visualViewport?.addEventListener("resize", this.boundResize);
        window.visualViewport?.addEventListener("scroll", this.boundResize);

    }

    clear(){

        this.ctx.fillStyle = "black";
        this.ctx.fillRect(
            0,
            0,
            this.canvas.width,
            this.canvas.height
        );

    }

}
