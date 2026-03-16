import Enemy from "../entities/Enemy.js";
import Config from "../game/Config.js";

export default class EnemyFormation {

    constructor(spriteSheet) {

        this.spriteSheet = spriteSheet;

        this.enemies = [];

        this.rows = 5;
        this.cols = 8;

        this.spacingX = 50;
        this.spacingY = 40;

        this.originX = 60;
        this.originY = 80;

        this.direction = 1;
        this.speed = 40;

        for (let row = 0; row < this.rows; row++) {

            for (let col = 0; col < this.cols; col++) {

                const slotX = col * this.spacingX;
                const slotY = row * this.spacingY;

                const enemy = new Enemy(
                    this.originX + slotX,
                    this.originY + slotY,
                    spriteSheet,
                    slotX,
                    slotY
                );

                this.enemies.push(enemy);

            }

        }

    }

    update(dt) {

        const formationWidth = (this.cols - 1) * this.spacingX;

        this.originX += this.speed * this.direction * dt;

        const leftEdge = this.originX;
        const rightEdge = this.originX + formationWidth;

        if (leftEdge < 20 || rightEdge > Config.width - 20) {
            this.direction *= -1;
        }

        this.enemies.forEach(enemy => {

            if (!enemy.active) return;

            if (enemy.state === "FORMATION") {

                enemy.x = this.originX + enemy.slotX;
                enemy.y =
    this.originY +
    enemy.slotY +
    Math.sin(performance.now() * 0.002) * 6;

            }

        });

    }

    draw(ctx) {

        this.enemies.forEach(enemy => {

            if (!enemy.active) return;

            enemy.draw(ctx);

        });

    }

}