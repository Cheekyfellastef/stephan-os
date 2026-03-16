import Renderer from "../engine/Renderer.js";
import Input from "../engine/Input.js";
import GameLoop from "./GameLoop.js";

import Player from "../entities/Player.js";
import EnemyFormation from "../systems/EnemyFormation.js";

import Starfield from "../systems/Starfield.js";
import Config from "./Config.js";

import EnemyDive from "../systems/EnemyDive.js";
import BulletManager from "../systems/BulletManager.js";
import Collision from "../engine/Collision.js";
import ExplosionSystem from "../systems/ExplosionSystem.js";
import ScoreSystem from "../systems/ScoreSystem.js";
import EnemyBrain from "../systems/EnemyBrain.js";
import WaveManager from "../systems/WaveManager.js";
import StageBanner from "../systems/StageBanner.js";

import EnemyBulletSystem from "../systems/EnemyBulletSystem.js";

export default class Game {

    constructor(canvas) {

        this.renderer = new Renderer(canvas);
        this.input = new Input();

        this.starfield = new Starfield(Config.width, Config.height);

        this.player = new Player();

        this.bullets = new BulletManager();
        this.explosions = new ExplosionSystem();

        this.scoreSystem = new ScoreSystem();
        this.scoreSystem.wave = 1;

        this.stageBanner = new StageBanner();

        this.waveManager = new WaveManager(this);

        this.loop = new GameLoop(
            this.update.bind(this),
            this.render.bind(this)
        );

        // systems created after sprite loads
        this.enemies = null;
        this.enemyBrain = null;
        this.enemyDive = null;
        this.enemyBullets = null;
        this.formationMovement = null;

        // load sprite sheet
        this.spriteSheet = new Image();
        this.spriteSheet.src = "assets/sprites/galaxian.png";

        this.spriteSheet.onload = () => {

            const cleanSprite = this.makeTransparent(this.spriteSheet);

            this.enemies = new EnemyFormation(cleanSprite);

            this.enemyBrain = new EnemyBrain(this.enemies);
            this.enemyDive = new EnemyDive(this.enemies);
            this.enemyBullets = new EnemyBulletSystem(this.enemies);
            

        };

    }

    start() {
        this.loop.start();
    }

update(dt) {

    this.input.update();

    this.starfield.update(dt);

    this.player.update(this.input, dt);

    // run enemy systems only if enemies exist
    if (this.enemies) {



this.enemies.update(dt);

this.enemyBrain.update(dt, this.player);

this.enemyDive.update(dt);

this.enemies.enemies.forEach(enemy => {
    enemy.update(dt);
});

        this.enemyBullets.update(dt, this.player);

        this.bullets.update(dt, this.input, this.player);

        this.waveManager.update(dt);

        this.stageBanner.update(dt);

        // player bullet collisions
        this.bullets.bullets.forEach((bullet) => {

            this.enemies.enemies.forEach((enemy) => {

                if (!enemy.active) return;

                if (Collision.check(bullet, enemy)) {

                    bullet.active = false;
                    enemy.active = false;

                    this.explosions.spawn(enemy.x, enemy.y);

                    this.scoreSystem.add(100);

                }

            });

        });

    }

    this.explosions.update(dt);

}

    render() {

        this.renderer.clear();

        const ctx = this.renderer.ctx;

        this.starfield.draw(ctx);

        this.player.draw(ctx);

        if (this.enemies) {

            this.enemies.draw(ctx);
            this.enemyBullets.draw(ctx);

        }

        this.bullets.draw(ctx);

        this.explosions.draw(ctx);

        this.stageBanner.draw(
            ctx,
            this.renderer.canvas.width,
            this.renderer.canvas.height
        );

        this.scoreSystem.draw(ctx);

    }

    makeTransparent(image) {

        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;

        const ctx = canvas.getContext("2d");

        ctx.drawImage(image, 0, 0);

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;

        for (let i = 0; i < data.length; i += 4) {

            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // remove grey background
            if (r > 200 && g > 200 && b > 200) {
                data[i + 3] = 0;
            }

        }

        ctx.putImageData(imgData, 0, 0);

        const newImage = new Image();
        newImage.src = canvas.toDataURL();

        return newImage;
    }

}