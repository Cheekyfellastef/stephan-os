import EnemyBullet from "../entities/EnemyBullet.js";

export default class EnemyBulletSystem {

    constructor(formation) {

        this.formation = formation;
        this.bullets = [];

    }

    update(dt, player) {

        this.formation.enemies.forEach(enemy => {

            if (!enemy.active) return;
            if (enemy.state !== "DIVING") return;

            enemy.fireTimer += dt;

            if (enemy.hasFired) return;

            // only fire after dive has progressed
               if (enemy.fireTimer > 0.2 && enemy.diveTimer > 0.9) {

                enemy.hasFired = true;
                enemy.fireTimer = 0;

                // direction toward player
                const dx = player.x - enemy.x;
                const dy = player.y - enemy.y;

                const length = Math.sqrt(dx * dx + dy * dy);

                const vx = dx / length;
                const vy = dy / length;

                // flagship fires TWO bullets
                if (enemy.slotY === 0) {

                    this.bullets.push(
                        new EnemyBullet(enemy.x - 6, enemy.y, vx, vy)
                    );

                    this.bullets.push(
                        new EnemyBullet(enemy.x + 6, enemy.y, vx, vy)
                    );

                } else {

                    this.bullets.push(
                        new EnemyBullet(enemy.x, enemy.y, vx, vy)
                    );

                }

            }

        });

        this.bullets.forEach(b => b.update(dt));

        this.bullets = this.bullets.filter(b => b.active);

    }

    draw(ctx) {

        this.bullets.forEach(b => b.draw(ctx));

    }

}