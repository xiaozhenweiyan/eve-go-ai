// MCTS + 策略网络 - 带强化学习奖励算法
class MCTSNode {
    constructor(state, move = null, parent = null) {
        this.state = state;
        this.move = move;
        this.parent = parent;
        this.children = [];
        this.visits = 0;
        this.wins = 0;
        this.policyValue = 0;
        this.expanded = false;
    }

    getUCB1(explorationWeight = 1.414) {
        if (this.visits === 0) return Infinity;
        const exploitation = this.wins / this.visits;
        const exploration = explorationWeight * Math.sqrt(Math.log(this.parent.visits) / this.visits);
        return exploitation + exploration + this.policyValue * 0.15;
    }
}

class MCTS {
    constructor(boardSize = 19, iterations = 100) {
        this.boardSize = boardSize;
        this.iterations = iterations;
        this.root = null;
        this.policyNetwork = null;
    }

    setPolicyNetwork(network) { this.policyNetwork = network; }

    getBestMove(board, iterations = null) {
        const iter = iterations || this.iterations;
        this.root = new MCTSNode(board.getState());

        for (let i = 0; i < iter; i++) {
            const node = this.select(this.root);
            if (node === this.root && !node.expanded) {
                this.expand(node);
                continue;
            }
            const winner = this.simulate(node);
            this.backpropagate(node, winner);
        }

        if (!this.root.children || this.root.children.length === 0) return null;
        const bestChild = this.root.children.reduce((best, child) =>
            (child.visits > best.visits) ? child : best, this.root.children[0]);
        return bestChild ? bestChild.move : null;
    }

    select(node) {
        while (node.expanded && node.children.length > 0) node = this.getBestChild(node);
        if (!node.expanded) this.expand(node);
        return node.children.length > 0 ? this.getBestChild(node) : node;
    }

    getBestChild(node) {
        let best = null, bestUCB = -Infinity;
        for (const child of node.children) {
            const ucb = child.getUCB1();
            if (ucb > bestUCB) { bestUCB = ucb; best = child; }
        }
        return best || node.children[0];
    }

    expand(node) {
        if (node.expanded) return;
        const board = new GoBoard(this.boardSize);
        board.setState(node.state);
        const validMoves = board.getValidMovesFast();
        for (const move of validMoves) {
            const childBoard = board.clone();
            childBoard.makeMove(move[0], move[1]);
            const childNode = new MCTSNode(childBoard.getState(), move, node);
            if (this.policyNetwork) {
                childNode.policyValue = this.policyNetwork.evaluatePosition(board, move[0], move[1]);
            }
            node.children.push(childNode);
        }
        node.expanded = true;
    }

    simulate(node) {
        const board = new GoBoard(this.boardSize);
        board.setState(node.state);
        let moves = 0;
        const maxMoves = this.boardSize * this.boardSize;
        while (!board.isGameOver() && moves < maxMoves) {
            const validMoves = board.getValidMovesFast();
            if (validMoves.length === 0) { board.pass(); moves++; continue; }
            const move = this.policyNetwork
                ? this.policyNetwork.selectMove(board, validMoves, 0.3)
                : validMoves[Math.floor(Math.random() * validMoves.length)];
            board.makeMove(move[0], move[1]);
            moves++;
        }
        return board.getWinner();
    }

    backpropagate(node, winner) {
        while (node !== null) {
            node.visits++;
            const movePlayer = node.state.currentPlayer;
            if (winner === movePlayer) node.wins += 1;
            else if (winner !== 0 && winner !== null) node.wins += 0.1;
            else node.wins += 0.5;
            node = node.parent;
        }
    }
}

// 策略网络 - 纯手写特征评估 + 强化学习
class PolicyNetwork {
    constructor(boardSize = 19) {
        this.boardSize = boardSize;
        this.weights = this.initializeWeights();
        this.learningRate = 0.05;
        this.experienceBuffer = [];
    }

    initializeWeights() {
        return {
            capture: 3.0,
            atari: 2.0,
            saveAtari: 2.5,
            liberty: 0.3,
            territory: 0.4,
            influence: 0.2,
            connection: 0.1,
            approach: 1.2,
            starPoint: 1.0,
            thirdLine: 1.0,
            fourthLine: 0.8,
            edge: -0.3,
            firstLine: -0.8,
            selfAtari: -3.0,
            eyeShape: 3.0,
            eyeFill: 0,                 // 填充眼奖励为0（不惩罚也不奖励）
            territoryFill: -3.0,        // 填自己领地惩罚
            eyeCreation: 1.2,
            groupSafety: 1.0,
            cuttingPoint: 2.0,
            expand: 0.2,
            eyeSpaceProtect: 0.8,
            invasion: 2.5,              // 降低入侵奖励
            liveInEnemyTerritory: 4.0,  // 降低在对方领地做眼奖励
            borderFight: 2.0,           // 降低边界争夺奖励
            splitEnemy: 2.5,            // 降低分断对方奖励
            deepInvasion: 1.5,          // 降低深入对方腹地奖励
            enemyEyeDestroy: 2.0,
            reduceEnemyTerritory: 1.5,
            selfTerritoryAvoid: -1.5,   // 降低己方腹地惩罚
            koThreat: 1.5,              // 新增：制造劫材威胁
            koDefense: 2.0              // 新增：劫争防守价值
        };
    }

    getDiagonalNeighbors(board, idx) {
        const neighbors = [];
        const row = Math.floor(idx / this.boardSize);
        const col = idx % this.boardSize;
        if (row > 0 && col > 0) neighbors.push(idx - this.boardSize - 1);
        if (row > 0 && col < this.boardSize - 1) neighbors.push(idx - this.boardSize + 1);
        if (row < this.boardSize - 1 && col > 0) neighbors.push(idx + this.boardSize - 1);
        if (row < this.boardSize - 1 && col < this.boardSize - 1) neighbors.push(idx + this.boardSize + 1);
        return neighbors;
    }

    // 检查空点是否被color方完全包围（眼点）- O(1)
    isEyePoint(boardArr, idx, color) {
        const neighbors = this.getNeighborIndices(idx);
        for (const n of neighbors) {
            if (boardArr[n] !== color) return false;
        }
        return true;
    }

    // 获取邻居索引（不依赖board对象）
    getNeighborIndices(idx) {
        const neighbors = [];
        const row = Math.floor(idx / this.boardSize);
        const col = idx % this.boardSize;
        if (row > 0) neighbors.push(idx - this.boardSize);
        if (row < this.boardSize - 1) neighbors.push(idx + this.boardSize);
        if (col > 0) neighbors.push(idx - 1);
        if (col < this.boardSize - 1) neighbors.push(idx + 1);
        return neighbors;
    }

    // 检查落子是否会填自己的眼 - O(1)
    fillsOwnEye(boardArr, idx, color) {
        if (boardArr[idx] !== 0) return false;
        const neighbors = this.getNeighborIndices(idx);
        for (const n of neighbors) {
            if (boardArr[n] !== color) return false;
        }
        // 对角线检查
        const diagonals = this.getDiagonalIndices(idx);
        const row = Math.floor(idx / this.boardSize);
        const col = idx % this.boardSize;
        const onEdge = (row === 0 || row === this.boardSize - 1 || col === 0 || col === this.boardSize - 1);
        let enemyDiag = 0;
        for (const d of diagonals) {
            if (boardArr[d] === 3 - color) enemyDiag++;
        }
        if (onEdge) return enemyDiag === 0;
        return enemyDiag <= 1;
    }

    getDiagonalIndices(idx) {
        const diagonals = [];
        const row = Math.floor(idx / this.boardSize);
        const col = idx % this.boardSize;
        if (row > 0 && col > 0) diagonals.push(idx - this.boardSize - 1);
        if (row > 0 && col < this.boardSize - 1) diagonals.push(idx - this.boardSize + 1);
        if (row < this.boardSize - 1 && col > 0) diagonals.push(idx + this.boardSize - 1);
        if (row < this.boardSize - 1 && col < this.boardSize - 1) diagonals.push(idx + this.boardSize + 1);
        return diagonals;
    }

    // 快速检查：落子周围是否创造眼位潜力 - O(1) per neighbor
    createsEyePotentialFast(boardArr, idx, color) {
        const testBoard = new Int8Array(boardArr);
        testBoard[idx] = color;
        let eyeCount = 0;
        const neighbors = this.getNeighborIndices(idx);
        for (const n of neighbors) {
            if (testBoard[n] === 0 && this.isEyePoint(testBoard, n, color)) {
                eyeCount++;
            }
        }
        return eyeCount;
    }

    // 快速棋群安全性评估 - 只查邻居的眼位，不做完整flood fill
    evaluateGroupSafetyFast(boardArr, idx, color) {
        const testBoard = new Int8Array(boardArr);
        testBoard[idx] = color;
        
        // 收集这个落子所属棋群的所有相邻空点
        // 但不做完整flood fill，只查直接邻居的邻居
        const neighbors = this.getNeighborIndices(idx);
        let eyeCount = 0;
        let potentialEyeCount = 0;
        const checkedEmpty = new Set();
        
        // 检查落子位置周围的眼位
        for (const n of neighbors) {
            if (testBoard[n] === 0 && !checkedEmpty.has(n)) {
                checkedEmpty.add(n);
                if (this.isEyePoint(testBoard, n, color)) {
                    // 确认是否真眼（对角线检查）
                    const diags = this.getDiagonalIndices(n);
                    const row = Math.floor(n / this.boardSize);
                    const col = n % this.boardSize;
                    const onEdge = (row === 0 || row === this.boardSize - 1 || col === 0 || col === this.boardSize - 1);
                    let enemyDiag = 0;
                    for (const d of diags) {
                        if (testBoard[d] === 3 - color) enemyDiag++;
                    }
                    if (onEdge ? enemyDiag === 0 : enemyDiag <= 1) {
                        eyeCount++;
                    } else {
                        potentialEyeCount++;
                    }
                }
            }
        }
        
        if (eyeCount >= 2) return this.weights.groupSafety * 2;
        if (eyeCount === 1) return this.weights.groupSafety * 0.5;
        if (potentialEyeCount >= 2) return this.weights.eyeCreation * 0.5;
        if (potentialEyeCount === 1) return this.weights.eyeCreation * 0.2;
        return 0;
    }

    // 检查落子是否在己方领地内 - 使用预计算的领地图
    fillsOwnTerritoryFast(territoryMap, idx, color) {
        return territoryMap[idx] === color;
    }

    // 是否是扩展势力的落子 - O(1)
    isExpansionMoveFast(boardArr, idx, color) {
        const neighbors = this.getNeighborIndices(idx);
        let friendlyCount = 0, enemyCount = 0, emptyCount = 0;
        for (const n of neighbors) {
            if (boardArr[n] === color) friendlyCount++;
            else if (boardArr[n] === 3 - color) enemyCount++;
            else emptyCount++;
        }
        return emptyCount >= 2 && friendlyCount <= 1 && enemyCount === 0;
    }

    // 影响力评估 - O(25)，不依赖flood fill
    evaluateInfluenceFast(boardArr, idx, color) {
        let influence = 0;
        const row = Math.floor(idx / this.boardSize);
        const col = idx % this.boardSize;
        for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = row + dr, nc = col + dc;
                if (nr < 0 || nr >= this.boardSize || nc < 0 || nc >= this.boardSize) continue;
                const ni = nr * this.boardSize + nc;
                const dist = Math.abs(dr) + Math.abs(dc);
                if (dist === 0) continue;
                if (boardArr[ni] === color) influence += 0.1 / dist;
                else if (boardArr[ni] === 3 - color) influence -= 0.05 / dist;
            }
        }
        return influence * this.weights.influence;
    }

    // === 新增：入侵与边界评估 ===

    // 检查落子点是否被对方棋子包围（对方领地内）- O(4)
    isSurroundedByEnemy(boardArr, idx, color) {
        const opponent = 3 - color;
        const neighbors = this.getNeighborIndices(idx);
        let enemyCount = 0, emptyCount = 0;
        for (const n of neighbors) {
            if (boardArr[n] === opponent) enemyCount++;
            else if (boardArr[n] === 0) emptyCount++;
        }
        // 2个以上对方邻居且空位少 = 在对方势力范围内
        return enemyCount >= 2 && emptyCount <= 1;
    }

    // 检查落子点是否在双方边界上 - O(8)
    isBorderPoint(boardArr, idx, color) {
        const opponent = 3 - color;
        const neighbors = this.getNeighborIndices(idx);
        let hasFriendly = false, hasEnemy = false, hasEmpty = false;
        for (const n of neighbors) {
            if (boardArr[n] === color) hasFriendly = true;
            else if (boardArr[n] === opponent) hasEnemy = true;
            else hasEmpty = true;
        }
        // 边界 = 同时接触双方棋子，或有空位在双方之间
        return (hasFriendly && hasEnemy) || (hasEnemy && hasEmpty);
    }

    // 评估打入对方领地 - O(1)
    evaluateInvasion(boardArr, testBoard, idx, color) {
        const opponent = 3 - color;
        const neighbors = this.getNeighborIndices(idx);
        let enemyCount = 0, friendlyCount = 0, emptyCount = 0;
        for (const n of neighbors) {
            if (boardArr[n] === opponent) enemyCount++;
            else if (boardArr[n] === color) friendlyCount++;
            else emptyCount++;
        }

        let invasionScore = 0;

        // 打入奖励：对方邻居越多奖励越高
        if (enemyCount >= 2) {
            // 基础打入奖励，friendlyCount越少奖励越高
            const isolationBonus = friendlyCount === 0 ? 1.0 : (friendlyCount === 1 ? 0.6 : 0.3);
            invasionScore += this.weights.invasion * isolationBonus;

            // 在对方领地内做出眼位 = 极高奖励
            const eyes = this.createsEyePotentialFast(boardArr, idx, color);
            if (eyes > 0) {
                invasionScore += eyes * this.weights.liveInEnemyTerritory;
            }

            // 如果落子后气数 >= 3，有活棋潜力
            const { liberties } = this.countLibertiesFast(testBoard, idx);
            if (liberties >= 3) {
                invasionScore += this.weights.liveInEnemyTerritory * 0.4;
            } else if (liberties === 2) {
                invasionScore += this.weights.liveInEnemyTerritory * 0.15;
            }

            // 如果能提子 = 更强的打入（提子奖励已在前面计算，这里给额外加成）
            if (emptyCount <= 1) {
                invasionScore += this.weights.invasion * 0.3;
            }
        }

        return invasionScore;
    }

    // 评估深入对方腹地 - 检查3x3范围内对方棋子密度
    evaluateDeepInvasion(boardArr, idx, color) {
        const opponent = 3 - color;
        const row = Math.floor(idx / this.boardSize);
        const col = idx % this.boardSize;
        let enemyCount = 0, totalCount = 0;

        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = row + dr, nc = col + dc;
                if (nr < 0 || nr >= this.boardSize || nc < 0 || nc >= this.boardSize) continue;
                const ni = nr * this.boardSize + nc;
                if (boardArr[ni] !== 0) {
                    totalCount++;
                    if (boardArr[ni] === opponent) enemyCount++;
                }
            }
        }

        // 3x3范围内对方密度高 = 深入腹地
        if (totalCount >= 4 && enemyCount / totalCount >= 0.7) {
            return this.weights.deepInvasion;
        }
        if (totalCount >= 3 && enemyCount === totalCount) {
            return this.weights.deepInvasion * 0.7;
        }
        return 0;
    }

    // 评估是否破坏对方眼位 - 落子后让对方潜在眼位减少
    evaluateEnemyEyeDestroy(boardArr, testBoard, idx, color) {
        const opponent = 3 - color;
        const neighbors = this.getNeighborIndices(idx);
        let destroyed = 0;

        for (const n of neighbors) {
            // 检查邻居是否原本是对方的眼位（或潜在眼位），落子后不再是
            if (boardArr[n] === 0) {
                const wasEye = this.isEyePoint(boardArr, n, opponent);
                const isEyeNow = this.isEyePoint(testBoard, n, opponent);
                if (wasEye && !isEyeNow) {
                    destroyed++;
                }
            }
        }

        return destroyed * this.weights.enemyEyeDestroy;
    }

    // 评估减少对方领地 - 在对方领地内落子
    evaluateReduceEnemyTerritory(territoryMap, idx, color) {
        if (!territoryMap) return 0;
        const opponent = 3 - color;
        // 如果落子点属于对方领地，就是减少对方领地
        if (territoryMap[idx] === opponent) {
            return this.weights.reduceEnemyTerritory;
        }
        return 0;
    }

    // 评估己方腹地惩罚 - 在己方完全控制的区域落子
    evaluateSelfTerritoryAvoid(boardArr, idx, color) {
        const neighbors = this.getNeighborIndices(idx);
        let friendlyCount = 0, enemyCount = 0;
        for (const n of neighbors) {
            if (boardArr[n] === color) friendlyCount++;
            else if (boardArr[n] === 3 - color) enemyCount++;
        }
        // 如果周围全是自己棋子且没有对方棋子 = 己方腹地，不该落子
        if (friendlyCount >= 3 && enemyCount === 0) {
            return this.weights.selfTerritoryAvoid;
        }
        return 0;
    }

    // 快速计算气数（不做完整group search，只算直接邻居空位）- O(4)
    countLibertiesFast(boardArr, idx) {
        const neighbors = this.getNeighborIndices(idx);
        let liberties = 0;
        for (const n of neighbors) {
            if (boardArr[n] === 0) liberties++;
        }
        return { liberties };
    }

    // 评估边界争夺 - O(8)
    evaluateBorderFight(boardArr, idx, color) {
        const opponent = 3 - color;
        const row = Math.floor(idx / this.boardSize);
        const col = idx % this.boardSize;
        let borderScore = 0;

        // 检查3x3范围内双方棋子分布
        let friendlyNearby = 0, enemyNearby = 0;
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = row + dr, nc = col + dc;
                if (nr < 0 || nr >= this.boardSize || nc < 0 || nc >= this.boardSize) continue;
                const ni = nr * this.boardSize + nc;
                if (boardArr[ni] === color) friendlyNearby++;
                else if (boardArr[ni] === opponent) enemyNearby++;
            }
        }

        // 双方都有棋子附近 = 边界线，争夺价值高
        if (friendlyNearby > 0 && enemyNearby > 0) {
            borderScore += this.weights.borderFight;
            // 如果双方数量接近 = 关键边界点
            if (Math.abs(friendlyNearby - enemyNearby) <= 1) {
                borderScore += this.weights.borderFight * 0.5;
            }
        }

        return borderScore;
    }

    // 评估分断对方 - O(4) 检查是否将对方的两个棋子/棋群分开
    evaluateSplitEnemy(boardArr, testBoard, idx, color) {
        const opponent = 3 - color;
        const neighbors = this.getNeighborIndices(idx);

        // 收集相邻的对方棋子所在的棋群代表
        const enemyGroups = new Set();
        for (const n of neighbors) {
            if (boardArr[n] === opponent) {
                // 找这个方向上的对方棋子是否被落子切断联系
                enemyGroups.add(n);
            }
        }

        // 如果相邻有2个以上的对方棋子，且它们现在被分开了
        if (enemyGroups.size >= 2) {
            // 检查这些对方棋子在落子后是否还连通
            const enemyArr = Array.from(enemyGroups);
            let split = false;
            for (let i = 0; i < enemyArr.length; i++) {
                for (let j = i + 1; j < enemyArr.length; j++) {
                    // 如果两个对方棋子原本可以通过空位连通，现在被 idx 挡住了
                    if (this.areAdjacent(enemyArr[i], enemyArr[j]) && testBoard[idx] === color) {
                        split = true;
                    }
                }
            }
            if (split) return this.weights.splitEnemy;
        }

        return 0;
    }

    areAdjacent(idx1, idx2) {
        const row1 = Math.floor(idx1 / this.boardSize), col1 = idx1 % this.boardSize;
        const row2 = Math.floor(idx2 / this.boardSize), col2 = idx2 % this.boardSize;
        return Math.abs(row1 - row2) <= 1 && Math.abs(col1 - col2) <= 1 && !(row1 === row2 && col1 === col2);
    }

    // 评估某个位置的策略价值（高性能版）
    // territoryMap: 预计算的领地图，避免重复flood fill
    evaluatePosition(board, row, col, territoryMap = null) {
        let score = 0;
        const player = board.currentPlayer;
        const opponent = 3 - player;
        const i = board.idx(row, col);
        const boardArr = board.board;

        // === 核心惩罚：填自己的眼 - O(1) ===
        if (this.fillsOwnEye(boardArr, i, player)) {
            return this.weights.eyeFill;  // 填眼奖励为0，不惩罚也不奖励
        }

        // 模拟落子
        const testBoard = new Int8Array(boardArr);
        testBoard[i] = player;

        // 1. 提子价值 - 只检查邻居
        let captured = 0;
        const neighbors = this.getNeighborIndices(i);
        const checked = new Set();
        for (const n of neighbors) {
            if (testBoard[n] === opponent && !checked.has(n)) {
                const { group, liberties } = board.findGroupAndLiberties(testBoard, n);
                group.forEach(g => checked.add(g));
                if (liberties === 0) {
                    captured += group.length;
                    for (const g of group) testBoard[g] = 0;
                }
            }
        }
        score += captured * this.weights.capture;

        // 2. 气数评估
        const { liberties: myLiberties } = board.findGroupAndLiberties(testBoard, i);
        score += myLiberties * this.weights.liberty;

        // 3. 自打吃惩罚
        if (myLiberties === 1) score += this.weights.selfAtari;

        // 4. 打吃对方
        for (const n of neighbors) {
            if (boardArr[n] === opponent) {
                const { liberties } = board.findGroupAndLiberties(boardArr, n);
                if (liberties === 2) score += this.weights.atari;
            }
        }

        // 5. 救己方被打吃的子
        for (const n of neighbors) {
            if (boardArr[n] === player) {
                const { liberties } = board.findGroupAndLiberties(boardArr, n);
                if (liberties === 1) score += this.weights.saveAtari;
            }
        }

        // 6. 位置价值 - O(1)
        score += this.evaluatePositionalValue(row, col);

        // 7. 连接价值（极低，避免占满自己的地）
        score += this.evaluateConnection(boardArr, i, player);

        // 8. 靠近对方棋子 - O(1)
        for (const n of neighbors) {
            if (boardArr[n] === opponent) score += this.weights.approach;
        }

        // === 9. 新增核心：入侵对方领地 ===
        score += this.evaluateInvasion(boardArr, testBoard, i, player);

        // === 10. 新增核心：深入对方腹地 ===
        score += this.evaluateDeepInvasion(boardArr, i, player);

        // === 11. 新增核心：破坏对方眼位 ===
        score += this.evaluateEnemyEyeDestroy(boardArr, testBoard, i, player);

        // === 12. 新增核心：减少对方领地 ===
        score += this.evaluateReduceEnemyTerritory(territoryMap, i, player);

        // === 13. 新增核心：己方腹地惩罚 ===
        score += this.evaluateSelfTerritoryAvoid(boardArr, i, player);

        // === 14. 新增核心：边界争夺 ===
        score += this.evaluateBorderFight(boardArr, i, player);

        // === 15. 新增核心：分断对方 ===
        score += this.evaluateSplitEnemy(boardArr, testBoard, i, player);

        // 16. 眼形评估 - 己方做眼奖励降低
        const eyesCreated = this.createsEyePotentialFast(boardArr, i, player);
        if (eyesCreated > 0) score += eyesCreated * this.weights.eyeCreation;

        // 17. 棋群安全性
        score += this.evaluateGroupSafetyFast(boardArr, i, player);

        // 18. 领地填充惩罚（极严厉）
        if (territoryMap && this.fillsOwnTerritoryFast(territoryMap, i, player)) {
            score += this.weights.territoryFill;
        }

        // 19. 影响力评估 - O(25)
        score += this.evaluateInfluenceFast(testBoard, i, player);

        // 20. 劫争评估 - 如果当前有劫争，评估制造劫材或应对劫争的价值
        score += this.evaluateKo(board, row, col, player);

        return score;
    }

    // 评估劫争相关价值
    evaluateKo(board, row, col, color) {
        let koScore = 0;

        // 如果当前有劫争
        if (board.hasKoThreat && board.hasKoThreat()) {
            const koPoint = board.getKoPoint();

            // 如果是制造劫材的落子（能在别处造成威胁）
            // 检查这个落子是否能影响劫争结果
            if (board.koPlayer === color) {
                // 当前玩家受限，需要找劫材
                // 如果这个落子能提子或有其他威胁价值，增加劫材价值
                const neighbors = this.getNeighborIndices(board.idx(row, col));
                for (const n of neighbors) {
                    if (board.board[n] === 3 - color) {
                        const { liberties } = board.findGroupAndLiberties(board.board, n);
                        if (liberties <= 2) {
                            koScore += this.weights.koThreat;
                            break;
                        }
                    }
                }
            } else {
                // 对方受限，这个落子可能是应对劫争
                koScore += this.weights.koDefense * 0.5;
            }
        }

        return koScore;
    }

    evaluatePositionalValue(row, col) {
        let score = 0;
        const size = this.boardSize;
        const distEdge = Math.min(row, col, size - 1 - row, size - 1 - col);
        const starPoints = size === 19
            ? [[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]] : [];
        for (const [sr, sc] of starPoints) {
            if (row === sr && col === sc) { score += this.weights.starPoint; break; }
        }
        if (distEdge === 0) score += this.weights.firstLine;
        else if (distEdge === 1) score += this.weights.edge;
        else if (distEdge === 2) score += this.weights.thirdLine;
        else if (distEdge === 3) score += this.weights.fourthLine;
        return score;
    }

    evaluateConnection(boardArr, idx, color) {
        let score = 0;
        const neighbors = this.getNeighborIndices(idx);
        let friendlyCount = 0;
        for (const n of neighbors) {
            if (boardArr[n] === color) friendlyCount++;
        }
        if (friendlyCount === 1) score += this.weights.connection;
        else if (friendlyCount === 2) score += this.weights.connection * 0.3;
        return score;
    }

    // 选择落子 - 缓存领地计算，避免重复flood fill
    selectMove(board, validMoves, temperature = 0.5) {
        if (validMoves.length === 0) return null;
        if (validMoves.length === 1) return validMoves[0];

        // 领地只计算一次（如果棋局已过开局阶段）
        let territoryMap = null;
        if (board.moveCount > 30) {
            territoryMap = board.calculateTerritoryDetail().map;
        }

        // 计算每个落子的分数
        const scores = validMoves.map(move =>
            this.evaluatePosition(board, move[0], move[1], territoryMap)
        );

        // 过滤掉填眼和在己方腹地无意义落子（除非所有落子都是）
        const nonEyeFillMoves = [];
        const nonEyeFillScores = [];
        const boardArr = board.board;
        for (let i = 0; i < validMoves.length; i++) {
            const move = validMoves[i];
            const mi = board.idx(move[0], move[1]);
            // 明确检查是否填眼
            const isEyeFill = this.fillsOwnEye(boardArr, mi, board.currentPlayer);
            // 中盘阶段（30-120手），额外过滤掉完全在己方腹地且无战略价值的落子
            let isBadFill = false;
            if (!isEyeFill && board.moveCount > 30 && board.moveCount < 120 && territoryMap) {
                // 如果落在己方领地，且总分低于一个阈值（说明没有入侵/分断等价值）
                if (territoryMap[mi] === board.currentPlayer && scores[i] < -2.0) {
                    isBadFill = true;
                }
            }
            if (!isEyeFill && !isBadFill) {
                nonEyeFillMoves.push(validMoves[i]);
                nonEyeFillScores.push(scores[i]);
            }
        }

        let useMoves, useScores;
        if (nonEyeFillMoves.length > 0) {
            useMoves = nonEyeFillMoves;
            useScores = nonEyeFillScores;
        } else {
            useMoves = validMoves;
            useScores = scores;
        }

        // 加入随机探索
        if (temperature > 0) {
            const maxScore = Math.max(...useScores);
            const expScores = useScores.map(s => Math.exp((s - maxScore) / Math.max(1, temperature * 10)));
            const sumExp = expScores.reduce((a, b) => a + b, 0);
            const probs = expScores.map(e => e / sumExp);
            let r = Math.random();
            for (let i = 0; i < probs.length; i++) {
                r -= probs[i];
                if (r <= 0) return useMoves[i];
            }
        }

        // 贪心选择
        let bestIdx = 0;
        let bestScore = useScores[0];
        for (let i = 1; i < useScores.length; i++) {
            if (useScores[i] > bestScore) { bestScore = useScores[i]; bestIdx = i; }
        }
        return useMoves[bestIdx];
    }

    // 从最终结果学习
    learnFromResult(isWin) {
        const lr = this.learningRate;
        const w = this.weights;
        if (isWin) {
            // 赢棋：稍微强化当前策略
            w.capture += lr * 0.01;
            w.atari += lr * 0.01;
            w.invasion += lr * 0.015;
            w.liveInEnemyTerritory += lr * 0.02;
            w.borderFight += lr * 0.015;
            w.splitEnemy += lr * 0.015;
            w.deepInvasion += lr * 0.01;
            w.enemyEyeDestroy += lr * 0.01;
            w.koThreat += lr * 0.01;
            w.koDefense += lr * 0.01;
            // eyeFill 保持为0，不调整
        } else {
            // 输棋：增强进攻性，提高做眼和防守
            w.eyeShape += lr * 0.02;
            w.eyeCreation += lr * 0.015;
            w.groupSafety += lr * 0.015;
            w.saveAtari += lr * 0.02;
            w.invasion += lr * 0.02;
            w.liveInEnemyTerritory += lr * 0.025;
            w.borderFight += lr * 0.02;
            w.splitEnemy += lr * 0.02;
            w.koThreat += lr * 0.015;
            w.koDefense += lr * 0.015;
            w.territoryFill -= lr * 0.01;
            w.selfTerritoryAvoid -= lr * 0.01;
            // eyeFill 保持为0，不调整
        }
        const keys = Object.keys(w);
        for (const key of keys) w[key] = Math.max(-5, Math.min(5, this.weights[key]));
    }

    applyReward(gameMoves, winner) {
        if (gameMoves.length === 0) { this.learnFromResult(winner === 1); return; }
        const gamma = 0.95;
        const moveCount = gameMoves.length;
        for (let t = 0; t < moveCount; t++) {
            const move = gameMoves[t];
            const isWinner = (move.player === winner);
            const isLoser = (winner !== 0 && move.player !== winner);
            const temporalWeight = Math.pow(gamma, moveCount - 1 - t);
            const reward = isWinner ? temporalWeight : (isLoser ? -temporalWeight : 0);
            this.experienceBuffer.push({ state: move.state, move: [move.row, move.col], player: move.player, reward, timestamp: t });
        }
        if (this.experienceBuffer.length > 1000) this.experienceBuffer = this.experienceBuffer.slice(-1000);
        this.updateWeightsFromExperience();
    }

    updateWeightsFromExperience() {
        if (this.experienceBuffer.length === 0) return;
        const batchSize = Math.min(20, this.experienceBuffer.length);
        const samples = [];
        for (let i = 0; i < batchSize; i++) {
            samples.push(this.experienceBuffer[Math.floor(Math.random() * this.experienceBuffer.length)]);
        }
        const lr = this.learningRate;
        const gradients = {};
        for (const key in this.weights) gradients[key] = 0;
        for (const exp of samples) {
            const board = new GoBoard(this.boardSize);
            board.setState(exp.state);
            const features = this.extractFeatures(board, exp.move[0], exp.move[1]);
            for (const key in features) gradients[key] = (gradients[key] || 0) + features[key] * exp.reward;
        }
        for (const key in this.weights) {
            if (gradients[key] !== undefined) {
                this.weights[key] += lr * gradients[key] / batchSize;
                this.weights[key] = Math.max(-5, Math.min(5, this.weights[key]));
            }
        }
    }

    extractFeatures(board, row, col) {
        const features = {};
        const player = board.currentPlayer;
        const opponent = 3 - player;
        const i = board.idx(row, col);
        const boardArr = board.board;
        const testBoard = new Int8Array(boardArr);
        testBoard[i] = player;

        let captured = 0;
        const neighbors = this.getNeighborIndices(i);
        const checked = new Set();
        for (const n of neighbors) {
            if (testBoard[n] === opponent && !checked.has(n)) {
                const { group, liberties } = board.findGroupAndLiberties(testBoard, n);
                group.forEach(g => checked.add(g));
                if (liberties === 0) { captured += group.length; for (const g of group) testBoard[g] = 0; }
            }
        }
        features.capture = captured;
        const { liberties } = board.findGroupAndLiberties(testBoard, i);
        features.liberty = liberties;
        features.selfAtari = liberties === 1 ? 1 : 0;

        let atariCount = 0, saveCount = 0;
        for (const n of neighbors) {
            if (boardArr[n] === opponent) {
                const { liberties: oppLib } = board.findGroupAndLiberties(boardArr, n);
                if (oppLib === 2) atariCount++;
            }
            if (boardArr[n] === player) {
                const { liberties: myLib } = board.findGroupAndLiberties(boardArr, n);
                if (myLib === 1) saveCount++;
            }
        }
        features.atari = atariCount;
        features.saveAtari = saveCount;

        const distEdge = Math.min(row, col, this.boardSize - 1 - row, this.boardSize - 1 - col);
        features.firstLine = distEdge === 0 ? 1 : 0;
        features.edge = distEdge === 1 ? 1 : 0;
        features.thirdLine = distEdge === 2 ? 1 : 0;
        features.fourthLine = distEdge === 3 ? 1 : 0;
        features.starPoint = this.isStarPoint(row, col) ? 1 : 0;

        let friendlyCount = 0;
        for (const n of neighbors) { if (boardArr[n] === player) friendlyCount++; }
        features.connection = friendlyCount === 1 ? 1 : 0;

        let approachCount = 0;
        for (const n of neighbors) { if (boardArr[n] === opponent) approachCount++; }
        features.approach = approachCount;

        features.eyeFill = this.fillsOwnEye(boardArr, i, player) ? 1 : 0;
        features.eyeCreation = this.createsEyePotentialFast(boardArr, i, player);
        features.groupSafety = this.evaluateGroupSafetyFast(boardArr, i, player) > 0 ? 1 : 0;
        features.expand = this.isExpansionMoveFast(boardArr, i, player) ? 1 : 0;

        let influence = 0;
        for (const n of neighbors) { if (testBoard[n] === 0) influence += 0.5; }
        features.influence = influence;

        return features;
    }

    isStarPoint(row, col) {
        if (this.boardSize !== 19) return false;
        const stars = [[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]];
        return stars.some(([r, c]) => r === row && c === col);
    }

    save() {
        return {
            boardSize: this.boardSize,
            weights: { ...this.weights },
            learningRate: this.learningRate,
            experienceCount: this.experienceBuffer.length
        };
    }

    load(data) {
        this.boardSize = data.boardSize || this.boardSize;
        this.weights = { ...this.weights, ...(data.weights || {}) };
        this.learningRate = data.learningRate || this.learningRate;
    }
}
