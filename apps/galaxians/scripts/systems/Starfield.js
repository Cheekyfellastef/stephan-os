export default class Starfield {

    constructor(width, height){

        this.width = width;
        this.height = height;

        this.stars = [];

        const STAR_COUNT = 120;

        for(let i=0;i<STAR_COUNT;i++){

            this.stars.push({
                x: Math.random()*width,
                y: Math.random()*height,
                speed: 10 + Math.random()*40
            });

        }

    }

    update(dt){

        this.stars.forEach(star => {

            star.y += star.speed * dt;

            if(star.y > this.height){
                star.y = 0;
                star.x = Math.random()*this.width;
            }

        });

    }

    draw(ctx){

        ctx.fillStyle = "white";

        this.stars.forEach(star => {
            ctx.fillRect(star.x, star.y, 2, 2);
        });

    }

}