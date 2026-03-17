export default class EnemyBrain {

    constructor(formation) {

        this.formation = formation;

        this.attackTimer = 0;
        this.attackInterval = 3;

        this.maxAttackers = 3;

        this.attackBurstChance = 0.35;
        this.maxBurst = 3;

    }

    // Bezier helper
    bezier(t, p0, p1, p2, p3) {

        const u = 1 - t;

        const tt = t * t;
        const uu = u * u;

        const uuu = uu * u;
        const ttt = tt * t;

        return {
            x:
                uuu * p0.x +
                3 * uu * t * p1.x +
                3 * u * tt * p2.x +
                ttt * p3.x,

            y:
                uuu * p0.y +
                3 * uu * t * p1.y +
                3 * u * tt * p2.y +
                ttt * p3.y
        };

    }

    update(dt, player) {

        this.attackTimer += dt;

        const activeAttackers =
            this.formation.enemies.filter(
                e => e.state === "DIVING" || e.state === "RETURNING"
            ).length;

        if (
            this.attackTimer > this.attackInterval &&
            activeAttackers < this.maxAttackers
        ) {

            this.attackTimer = 0;

            let burstCount = 1;

            if (Math.random() < this.attackBurstChance) {
                burstCount = Math.floor(Math.random() * this.maxBurst) + 1;
            }

            const columns = {};

            this.formation.enemies.forEach(enemy => {

                if (!enemy.active) return;
                if (enemy.state !== "FORMATION") return;

                const column = Math.round(enemy.slotX);

                if (!columns[column] || enemy.y > columns[column].y) {
                    columns[column] = enemy;
                }

            });

            const candidates = Object.values(columns);

            if (candidates.length > 0) {

                for (let i = 0; i < burstCount; i++) {

                    if (candidates.length === 0) break;

                    let leader;

                    const flagships =
                        candidates.filter(e => e.slotY === 0);

                    if (flagships.length > 0 && Math.random() < 0.7) {

                        leader =
                            flagships[
                                Math.floor(Math.random() * flagships.length)
                            ];

                    } else {

                        leader =
                            candidates[
                                Math.floor(Math.random() * candidates.length)
                            ];

                    }

                    const index = candidates.indexOf(leader);
                    candidates.splice(index, 1);

                    leader.state = "DIVING";
                    leader.diveTimer = 0;

                    // escort logic
                    this.formation.enemies.forEach(enemy => {

                        if (!enemy.active) return;
                        if (enemy.state !== "FORMATION") return;

                        const dx = Math.abs(enemy.slotX - leader.slotX);
                        const dy = leader.slotY - enemy.slotY;

                        if (
                            dy === this.formation.spacingY &&
                            dx === this.formation.spacingX
                        ) {

                            enemy.state = "DIVING";
                            enemy.diveTimer = -0.4;

                        }

                    });

                }

            }

        }

        this.formation.enemies.forEach(enemy => {

            if (!enemy.active) return;

            if (enemy.state === "DIVING") {
                this.updateDive(enemy, player, dt);
            }

            if (enemy.state === "RETURNING") {
                this.updateReturn(enemy, dt);
            }

        });

    }

    updateDive(enemy, player, dt) {

        enemy.diveTimer += dt;

        if (enemy.diveTimer < 0) return;

        if (!enemy.divePath) {

            const startX = enemy.x;
            const startY = enemy.y;

            const side = Math.random() < 0.5 ? -1 : 1;

            enemy.divePath = {

                p0: { x: startX, y: startY },

                p1: {
                    x: startX + 120 * side,
                    y: startY + 80
                },

                p2: {
                    x: startX + 160 * side,
                    y: startY + 220
                },

                p3: {
                    x: startX,
                    y: 720
                }

            };

        }

        const speed = 0.35;
        const t = enemy.diveTimer * speed;

        const pos = this.bezier(
            t,
            enemy.divePath.p0,
            enemy.divePath.p1,
            enemy.divePath.p2,
            enemy.divePath.p3
        );

        enemy.x = pos.x;
        enemy.y = pos.y;

        if (enemy.y > 700) {

            enemy.state = "RETURNING";
            enemy.divePath = null;

            enemy.y = -40;

        }

    }

    updateReturn(enemy, dt) {

        const targetX =
            enemy.slotX + this.formation.originX;

        const targetY =
            enemy.slotY + this.formation.originY;

        const dx = targetX - enemy.x;
        const dy = targetY - enemy.y;

        const distance = Math.sqrt(dx * dx + dy * dy);

        const speed = 180;
        const step = speed * dt;

        if (distance <= step) {

            enemy.x = targetX;
            enemy.y = targetY;

            enemy.state = "FORMATION";

            enemy.hasFired = false;
            enemy.fireTimer = 0;

            return;

        }

        enemy.x += (dx / distance) * step;
        enemy.y += (dy / distance) * step;

    }

}