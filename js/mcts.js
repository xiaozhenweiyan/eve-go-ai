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

    setPolicyNetwork(network) {
        this.policyNetwork = network;
    }

    // 人机对战用：完整MCTS搜索
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

        const bestChild = this.root.children.reduce((best, child) => {
            return (child.visits > best.visits) ? child : best;
        }, this.root.children[0]);

        return bestChild ? bestChild.move : null;
    }

    select(node) {
        while (node.expanded && node.children.length > 0) {
            node = this.getBestChild(node);
        }
        if (!node.expanded) {
            this.expand(node);
        }
        return node.children.length > 0 ? this.getBestChild(node) : node;
    }

    getBestChild(node) {
        let best = null;
        let bestUCB = -Infinity;
        for (const child of node.children) {
            const ucb = child.getUCB1();
            if (ucb > bestUCB) {
                bestUCB = ucb;
                best = child;
            }
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
                childNode.policyValue = this.policyNetwork.evaluatePosition(childBoard, move[0], move[1]);
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
            if (validMoves.length === 0) {
                board.pass();
                moves++;
                continue;
            }

            // 策略网络引导的快速模拟
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
            if (winner === movePlayer) {
                node.wins += 1;
            } else if (winner !== 0 && winner !== null) {
                node.wins += 0.1;
            } else {
                node.wins += 0.5;
            }
            node = node.parent;
        }
    }
}

// 策略网络 - 纯手写的特征评估 + 强化学习
class PolicyNetwork {
    constructor(boardSize = 19) {
        this.boardSize = boardSize;
        this.weights = this.initializeWeights();
        this.learningRate = 0.05;
        this.experienceBuffer = []; // 经验回放缓冲区
    }

    initializeWeights() {
        return {
            capture: 3.0,        // 提子价值
            atari: 2.0,          // 打吃（让对方只剩1气）
            saveAtari: 2.5,      // 救己方被打吃的子
            liberty: 0.5,        // 气数价值
            territory: 1.0,      // 领地控制
            influence: 0.3,      // 影响力
            connection: 0.4,     // 连接己方棋子
            approach: 0.3,       // 靠近对方棋子
            starPoint: 0.8,      // 星位偏好
            thirdLine: 0.6,      // 三线价值
            fourthLine: 0.5,     // 四线价值
            edge: -0.5,          // 边缘惩罚
            firstLine: -1.0,     // 一线惩罚
            selfAtari: -3.0,     // 自打吃惩罚
            eyeShape: 1.5,       // 眼形价值
            cuttingPoint: 0.7    // 切断点价值
        };
    }

    // 评估某个位置的策略价值
    evaluatePosition(board, row, col) {
        let score = 0;
        const player = board.currentPlayer;
        const opponent = 3 - player;
        const i = board.idx(row, col);

        // 模拟落子
        const testBoard = new Int8Array(board.board);
        testBoard[i] = player;

        // 1. 提子价值
        let captured = 0;
        const neighbors = board.getNeighbors(i);
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

        // 4. 打吃对方（让对方只剩1气）
        for (const n of neighbors) {
            if (board.board[n] === opponent) {
                const { liberties } = board.findGroupAndLiberties(board.board, n);
                if (liberties === 2) score += this.weights.atari;
            }
        }

        // 5. 救己方被打吃的子
        for (const n of neighbors) {
            if (board.board[n] === player) {
                const { liberties } = board.findGroupAndLiberties(board.board, n);
                if (liberties === 1) score += this.weights.saveAtari;
            }
        }

        // 6. 位置价值
        score += this.evaluatePositionalValue(row, col);

        // 7. 连接价值
        score += this.evaluateConnection(board, row, col);

        // 8. 靠近对方棋子
        let approachBonus = 0;
        for (const n of neighbors) {
            if (board.board[n] === opponent) approachBonus += this.weights.approach;
        }
        score += approachBonus;

        return score;
    }

    evaluatePositionalValue(row, col) {
        let score = 0;
        const size = this.boardSize;
        const center = Math.floor(size / 2);
        const distEdge = Math.min(row, col, size - 1 - row, size - 1 - col);

        // 星位偏好
        const starPoints = size === 19
            ? [[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]]
            : [];
        for (const [sr, sc] of starPoints) {
            if (row === sr && col === sc) {
                score += this.weights.starPoint;
                break;
            }
        }

        // 线价值
        if (distEdge === 0) score += this.weights.firstLine;
        else if (distEdge === 1) score += this.weights.edge;
        else if (distEdge === 2) score += this.weights.thirdLine;
        else if (distEdge === 3) score += this.weights.fourthLine;

        return score;
    }

    evaluateConnection(board, row, col) {
        let score = 0;
        const i = board.idx(row, col);
        const neighbors = board.getNeighbors(i);
        let friendlyCount = 0;
        for (const n of neighbors) {
            if (board.board[n] === board.currentPlayer) friendlyCount++;
        }
        score += friendlyCount * this.weights.connection;
        return score;
    }

    // 选择落子（训练用 - 带温度参数的探索）
    selectMove(board, validMoves, temperature = 0.5) {
        if (validMoves.length === 0) return null;
        if (validMoves.length === 1) return validMoves[0];

        // 计算每个落子的分数
        const scores = validMoves.map(move => this.evaluatePosition(board, move[0], move[1]));

        // 加入随机探索
        if (temperature > 0) {
            // softmax采样
            const maxScore = Math.max(...scores);
            const expScores = scores.map(s => Math.exp((s - maxScore) / Math.max(1, temperature * 10)));
            const sumExp = expScores.reduce((a, b) => a + b, 0);
            const probs = expScores.map(e => e / sumExp);

            let r = Math.random();
            for (let i = 0; i < probs.length; i++) {
                r -= probs[i];
                if (r <= 0) return validMoves[i];
            }
        }

        // 贪心选择
        let bestIdx = 0;
        let bestScore = scores[0];
        for (let i = 1; i < scores.length; i++) {
            if (scores[i] > bestScore) {
                bestScore = scores[i];
                bestIdx = i;
            }
        }
        return validMoves[bestIdx];
    }

    // 强化学习奖励更新 - 核心训练算法
    applyReward(gameMoves, winner) {
        if (gameMoves.length === 0) return;

        const gamma = 0.95; // 折扣因子
        const moveCount = gameMoves.length;

        // 时序差分奖励：后面的步骤获得更多奖惩
        for (let t = 0; t < moveCount; t++) {
            const move = gameMoves[t];
            const isWinner = (move.player === winner);
            const isLoser = (winner !== 0 && move.player !== winner);

            // 越接近终局的步骤，奖惩越大
            const temporalWeight = Math.pow(gamma, moveCount - 1 - t);
            const reward = isWinner ? temporalWeight : (isLoser ? -temporalWeight : 0);

            // 记录经验
            this.experienceBuffer.push({
                state: move.state,
                move: [move.row, move.col],
                player: move.player,
                reward: reward,
                timestamp: t
            });
        }

        // 限制经验缓冲区大小
        if (this.experienceBuffer.length > 1000) {
            this.experienceBuffer = this.experienceBuffer.slice(-1000);
        }

        // 从经验中学习，更新权重
        this.updateWeightsFromExperience();
    }

    updateWeightsFromExperience() {
        if (this.experienceBuffer.length === 0) return;

        // 采样一批经验
        const batchSize = Math.min(20, this.experienceBuffer.length);
        const samples = [];
        for (let i = 0; i < batchSize; i++) {
            const idx = Math.floor(Math.random() * this.experienceBuffer.length);
            samples.push(this.experienceBuffer[idx]);
        }

        const lr = this.learningRate;
        const gradients = {};
        for (const key in this.weights) gradients[key] = 0;

        for (const exp of samples) {
            const board = new GoBoard(this.boardSize);
            board.setState(exp.state);
            const features = this.extractFeatures(board, exp.move[0], exp.move[1]);

            // 根据奖励调整梯度
            for (const key in features) {
                gradients[key] = (gradients[key] || 0) + features[key] * exp.reward;
            }
        }

        // 应用梯度更新
        for (const key in this.weights) {
            if (gradients[key] !== undefined) {
                this.weights[key] += lr * gradients[key] / batchSize;
                // 权重裁剪
                this.weights[key] = Math.max(-5, Math.min(5, this.weights[key]));
            }
        }
    }

    // 提取特征向量（用于梯度计算）
    extractFeatures(board, row, col) {
        const features = {};
        const player = board.currentPlayer;
        const opponent = 3 - player;
        const i = board.idx(row, col);

        const testBoard = new Int8Array(board.board);
        testBoard[i] = player;

        // 提子特征
        let captured = 0;
        const neighbors = board.getNeighbors(i);
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
        features.capture = captured;

        // 气数特征
        const { liberties } = board.findGroupAndLiberties(testBoard, i);
        features.liberty = liberties;
        features.selfAtari = liberties === 1 ? 1 : 0;

        // 打吃特征
        let atariCount = 0;
        let saveCount = 0;
        for (const n of neighbors) {
            if (board.board[n] === opponent) {
                const { liberties: oppLib } = board.findGroupAndLiberties(board.board, n);
                if (oppLib === 2) atariCount++;
            }
            if (board.board[n] === player) {
                const { liberties: myLib } = board.findGroupAndLiberties(board.board, n);
                if (myLib === 1) saveCount++;
            }
        }
        features.atari = atariCount;
        features.saveAtari = saveCount;

        // 位置特征
        const distEdge = Math.min(row, col, this.boardSize - 1 - row, this.boardSize - 1 - col);
        features.firstLine = distEdge === 0 ? 1 : 0;
        features.edge = distEdge === 1 ? 1 : 0;
        features.thirdLine = distEdge === 2 ? 1 : 0;
        features.fourthLine = distEdge === 3 ? 1 : 0;
        features.starPoint = this.isStarPoint(row, col) ? 1 : 0;

        // 连接特征
        let friendlyCount = 0;
        for (const n of neighbors) {
            if (board.board[n] === player) friendlyCount++;
        }
        features.connection = friendlyCount;

        // 靠近对方
        let approachCount = 0;
        for (const n of neighbors) {
            if (board.board[n] === opponent) approachCount++;
        }
        features.approach = approachCount;

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