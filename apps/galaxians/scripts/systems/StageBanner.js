export default class StageBanner {
    constructor() {
        this.visible = false;
        this.timer = 0;
        this.stage = 1;
    }

    show(stage) {
        this.stage = stage;
        this.timer = 2;
        this.visible = true;
    }

    update(dt) {
        if (!this.visible) return;

        this.timer -= dt;

        if (this.timer <= 0) {
            this.visible = false;
        }
    }

    draw(ctx, width, height) {
        if (!this.visible) return;

        ctx.fillStyle = "white";
        ctx.font = "48px monospace";
        ctx.textAlign = "center";

        ctx.fillText(
            "STAGE " + this.stage,
            width / 2,
            height / 2
        );

        ctx.textAlign = "left";
    }
}