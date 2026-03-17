import Config from "../game/Config.js";
import Scaler from "./Scaler.js";

export default class Renderer {

    constructor(canvas){

        this.canvas = canvas;

        canvas.width = Config.baseWidth;
        canvas.height = Config.baseHeight;

        this.ctx = canvas.getContext("2d");

        this.ctx.imageSmoothingEnabled = false;

        Scaler.apply(canvas, Config.baseWidth, Config.baseHeight);

        window.addEventListener("resize", () => {
            Scaler.apply(canvas, Config.baseWidth, Config.baseHeight);
        });

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