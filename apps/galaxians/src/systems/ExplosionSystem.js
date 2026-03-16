export default class ExplosionSystem {

    constructor(){

        this.explosions = []
    }

    spawn(x,y){

        this.explosions.push({
            x:x,
            y:y,
            life:0.3
        })
    }

    update(dt){

        this.explosions.forEach(e => {
            e.life -= dt
        })

        this.explosions =
            this.explosions.filter(e => e.life > 0)
    }

    draw(ctx){

        this.explosions.forEach(e => {

            const radius = (0.3 - e.life) * 80

            ctx.beginPath()
            ctx.arc(e.x, e.y, radius, 0, Math.PI*2)

            ctx.fillStyle = "orange"
            ctx.fill()

        })
    }
}