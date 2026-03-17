export default class Enemy {

    constructor(x, y, spriteSheet, slotX, slotY) {

        this.x = x;
        this.y = y;

        this.spriteSheet = spriteSheet;

        this.slotX = slotX;
        this.slotY = slotY;

        this.width = 40;
        this.height = 40;

        this.frame = 0;
        this.animTimer = 0;

        this.state = "FORMATION";
        this.active = true;

        this.diveTimer = 0;

        this.hasFired = false;
        this.fireTimer = 0;

    }

  update(dt) {

    this.animTimer += dt;

    if (this.animTimer > 0.2) {

        this.frame = (this.frame + 1) % 2;
        this.animTimer = 0;

    }

}

    draw(ctx) {

        if (!this.active) return;

        if (!this.spriteSheet || !this.spriteSheet.complete) return;

        const frames = [
            { x: 20, y: 199, w: 12, h: 13 },
            { x: 36, y: 199, w: 12, h: 13 }
        ];

        const frame = frames[this.frame];

        if (!frame) return;

        ctx.drawImage(
            this.spriteSheet,
            frame.x,
            frame.y,
            frame.w,
            frame.h,
            this.x - this.width / 2,
            this.y - this.height / 2,
            this.width,
            this.height
        );

    }

}