export default class Sprite {

    constructor(src) {
        this.image = new Image();
        this.image.src = src;
    }

    draw(ctx, x, y, w, h) {

        // if image hasn't loaded yet, skip drawing
        if (!this.image.complete) return;

        ctx.drawImage(
            this.image,
            x - w / 2,
            y - h / 2,
            w,
            h
        );
    }
}