import Sprite from "../engine/Sprite.js";
import Config from "../game/Config.js";

export default class Player {

    constructor(){

        this.x = Config.width / 2;
        this.y = Config.height - 50;

        this.width = 40;
        this.height = 40;

        this.sprite = new Sprite("assets/sprites/player.png");

    }

    update(input, dt){

        if(input.left)
            this.x -= Config.playerSpeed * dt;

        if(input.right)
            this.x += Config.playerSpeed * dt;

        // keep player inside screen
        const halfWidth = this.width / 2;

        if(this.x < halfWidth)
            this.x = halfWidth;

        if(this.x > Config.width - halfWidth)
            this.x = Config.width - halfWidth;

    }

    draw(ctx){

        this.sprite.draw(
            ctx,
            this.x,
            this.y,
            this.width,
            this.height
        );

    }

}