import Bullet from "../entities/Bullet.js"

export default class BulletManager {

    constructor(){

        this.bullets = []
        this.fireCooldown = 0
    }

    update(dt, input, player){

        this.fireCooldown -= dt

        if(input.fire && this.fireCooldown <= 0){

            this.bullets.push(
                new Bullet(player.x, player.y - 20, -400)
            )

            this.fireCooldown = 0.25
        }

        this.bullets.forEach(b => b.update(dt))

        this.bullets = this.bullets.filter(b => b.active)
    }

    draw(ctx){

        this.bullets.forEach(b => b.draw(ctx))
    }
}