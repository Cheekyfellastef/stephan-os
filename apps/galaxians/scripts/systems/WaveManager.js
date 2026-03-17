import EnemyFormation from "./EnemyFormation.js";
import EnemyBrain from "./EnemyBrain.js";
import EnemyDive from "./EnemyDive.js";
import EnemyBulletSystem from "./EnemyBulletSystem.js";

export default class WaveManager {

    constructor(game) {

        this.game = game;

        this.wave = 1;

        this.respawnTimer = 0;
        this.waitingForNextWave = false;

    }

    update(dt) {

        if (!this.game.enemies) return;

        const enemiesRemaining =
            this.game.enemies.enemies.filter(e => e.active).length;

        if (enemiesRemaining === 0 && !this.waitingForNextWave) {

            this.waitingForNextWave = true;
            this.respawnTimer = 2;

            this.wave++;

            if (this.game.stageBanner) {
                this.game.stageBanner.show(this.wave);
            }

            this.game.scoreSystem.wave = this.wave;

        }

        if (this.waitingForNextWave) {

            this.respawnTimer -= dt;

            if (this.respawnTimer <= 0) {
                this.spawnWave();
            }

        }

    }

    spawnWave() {

        const sprite = this.game.enemies.spriteSheet;

        // create new formation
        this.game.enemies = new EnemyFormation(sprite);

        // reconnect enemy systems
        this.game.enemyBrain = new EnemyBrain(this.game.enemies);
        this.game.enemyDive = new EnemyDive(this.game.enemies);
        this.game.enemyBullets = new EnemyBulletSystem(this.game.enemies);

        this.waitingForNextWave = false;

    }

}