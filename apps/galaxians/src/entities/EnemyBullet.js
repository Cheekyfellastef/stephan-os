import Config from "../game/Config.js";

export default class EnemyBullet {

    constructor(x, y, vx, vy) {

        this.x = x;
        this.y = y;

        this.vx = vx;
        this.vy = vy;

        this.width = 4;
        this.height = 10;

        this.speed = 220;

        this.active = true;

    }

    update(dt) {

        // move bullet using velocity vector
        this.x += this.vx * this.speed * dt;
        this.y += this.vy * this.speed * dt;

        // deactivate if off screen
        if (
            this.y > Config.height + 20 ||
            this.y < -20 ||
            this.x < -20 ||
            this.x > Config.width + 20
        ) {
            this.active = false;
        }

    }

    draw(ctx) {

        if (!this.active) return;

        ctx.fillStyle = "red";

        ctx.fillRect(
            this.x - this.width / 2,
            this.y - this.height / 2,
            this.width,
            this.height
        );

    }

}