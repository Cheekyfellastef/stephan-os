export default class ScoreSystem {

    constructor(){

        this.score = 0
    }

    add(points){

        this.score += points
    }

    draw(ctx){

        ctx.fillStyle = "white"
        ctx.font = "20px monospace"

        ctx.fillText(
    "WAVE: " + this.wave,
    350,
    25
);
        ctx.fillText(
            "SCORE: " + this.score,
            10,
            25
        )
    }
}