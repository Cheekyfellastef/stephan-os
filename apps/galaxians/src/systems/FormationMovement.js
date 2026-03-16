import Config from "../game/Config.js";

export default class FormationMovement {

    constructor(formation) {

        this.formation = formation;

        this.direction = -1;

        this.edgePadding = 60;

    }

    update(dt) {

        if (!this.formation) return;

        const formationWidth =
            (this.formation.cols - 1) * this.formation.spacingX;

        const leftEdge = this.formation.originX;
        const rightEdge = this.formation.originX + formationWidth;

        const aliveEnemies =
            this.formation.enemies.filter(e => e.active).length;

        const totalEnemies =
            this.formation.rows * this.formation.cols;

        const progress = 1 - (aliveEnemies / totalEnemies);

        // speed increases as enemies die
        const speed = 25 + progress * 90;

        // bounce at screen edges
        if (
            leftEdge < this.edgePadding ||
            rightEdge > Config.width - this.edgePadding
        ) {
            this.direction *= -1;
        }

        // move formation anchor
        this.formation.originX += speed * this.direction * dt;

    }

}