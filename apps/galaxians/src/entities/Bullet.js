export default class Bullet {

    constructor(x, y, velocityY){

        this.x = x
        this.y = y

        this.velocityY = velocityY

        this.width = 4
        this.height = 10

        this.active = true
    }

    update(dt){

        this.y += this.velocityY * dt

        if(this.y < -20 || this.y > 700)
            this.active = false
    }

    draw(ctx){

        ctx.fillStyle = "yellow"

        ctx.fillRect(
            this.x - this.width/2,
            this.y - this.height/2,
            this.width,
            this.height
        )
    }
}