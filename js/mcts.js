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
            liberty: 0.4,
            territory: 1.0,
            influence: 0.35,
            connection: 0.3,
            approach: 0.3,
            starPoint: 0.8,
            thirdLine: 0.7,
            fourthLine: 0.5,
            edge: -0.5,
            firstLine: -1.0,
            selfAtari: -3.0,
            eyeShape: 4.0,
            eyeFill: -5.0,
            territoryFill: -3.0,
            eyeCreation: 3.5,
            groupSafety: 2.0,
            cuttingPoint: 0.7,
            expand: 0.6,
            eyeSpaceProtect: 2.5
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
            return this.weights.eyeFill;
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

        // 4. 打吃对方 - 只检查直接邻居的气
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

        // 7. 连接价值
        score += this.evaluateConnection(boardArr, i, player);

        // 8. 靠近对方棋子 - O(1)
        for (const n of neighbors) {
            if (boardArr[n] === opponent) score += this.weights.approach;
        }

        // 9. 眼形评估 - O(1)
        const eyesCreated = this.createsEyePotentialFast(boardArr, i, player);
        if (eyesCreated > 0) score += eyesCreated * this.weights.eyeCreation;

        // 10. 棋群安全性 - O(1) per neighbor
        score += this.evaluateGroupSafetyFast(boardArr, i, player);

        // 11. 领地填充惩罚 - O(1) with cached territory
        if (territoryMap && this.fillsOwnTerritoryFast(territoryMap, i, player)) {
            score += this.weights.territoryFill;
        }

        // 12. 扩展奖励 - O(1)
        if (this.isExpansionMoveFast(boardArr, i, player)) {
            score += this.weights.expand;
        }

        // 13. 影响力评估 - O(25)
        score += this.evaluateInfluenceFast(testBoard, i, player);

        return score;
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

        // 过滤掉填眼的落子（除非所有落子都是填眼）
        const nonEyeFillMoves = [];
        const nonEyeFillScores = [];
        for (let i = 0; i < validMoves.length; i++) {
            if (scores[i] > this.weights.eyeFill) {
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
            w.eyeShape += lr * 0.02;
            w.eyeCreation += lr * 0.02;
            w.eyeFill -= lr * 0.01;
            w.territoryFill -= lr * 0.01;
            w.groupSafety += lr * 0.02;
            w.expand += lr * 0.01;
        } else {
            w.eyeShape += lr * 0.03;
            w.eyeCreation += lr * 0.03;
            w.eyeFill -= lr * 0.02;
            w.territoryFill -= lr * 0.02;
            w.groupSafety += lr * 0.03;
            w.connection -= lr * 0.01;
            w.expand += lr * 0.02;
        }
        const keys = Object.keys(w);
        for (const key of keys) w[key] = Math.max(-5, Math.min(5, w[key]));
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
