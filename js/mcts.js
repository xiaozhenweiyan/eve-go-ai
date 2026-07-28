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
            if (validMoves.length === 0) {
                board.pass();
                moves++;
                continue;
            }

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
            capture: 3.0,          // 提子价值
            atari: 2.0,            // 打吃对方
            saveAtari: 2.5,        // 救己方被打吃的子
            liberty: 0.4,          // 气数价值（降低，避免纯粹追气）
            territory: 1.0,        // 领地控制
            influence: 0.35,       // 影响力扩展
            connection: 0.3,       // 连接己方棋子（降低，避免填充）
            approach: 0.3,         // 靠近对方棋子
            starPoint: 0.8,        // 星位偏好
            thirdLine: 0.7,        // 三线价值
            fourthLine: 0.5,       // 四线价值
            edge: -0.5,            // 边缘惩罚
            firstLine: -1.0,       // 一线惩罚
            selfAtari: -3.0,       // 自打吃惩罚
            eyeShape: 4.0,         // 眼形价值（大幅提高）
            eyeFill: -5.0,         // 填自己眼惩罚（新增核心项）
            territoryFill: -3.0,   // 填自己领地惩罚（新增）
            eyeCreation: 3.5,      // 造眼奖励（新增）
            groupSafety: 2.0,      // 棋群安全性（新增）
            cuttingPoint: 0.7,     // 切断点价值
            expand: 0.6,           // 扩展势力（新增）
            eyeSpaceProtect: 2.5   // 保护眼位空间（新增）
        };
    }

    // 获取对角线邻居
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

    // 检查一个空点是否是眼（被同色完全包围）
    isEye(board, idx, color) {
        const neighbors = board.getNeighbors(idx);
        for (const n of neighbors) {
            if (board.board[n] !== color) return false;
        }
        // 对角线检查：边上需要所有对角同色，角上需要全部
        const diagonals = this.getDiagonalNeighbors(board, idx);
        const row = Math.floor(idx / this.boardSize);
        const col = idx % this.boardSize;
        const onEdge = (row === 0 || row === this.boardSize - 1 || col === 0 || col === this.boardSize - 1);

        let friendlyDiag = 0;
        let enemyDiag = 0;
        let offBoardDiag = 0;
        for (const d of diagonals) {
            if (board.board[d] === color) friendlyDiag++;
            else if (board.board[d] === 3 - color) enemyDiag++;
        }
        // 边/角位置：所有对角必须是己方
        if (onEdge) {
            return enemyDiag === 0;
        }
        // 中央位置：最多1个对方对角
        return enemyDiag <= 1;
    }

    // 检查落子后是否能为己方创造眼位
    createsEyePotential(board, idx, color) {
        const testBoard = new Int8Array(board.board);
        testBoard[idx] = color;

        let eyeCount = 0;
        const neighbors = board.getNeighbors(idx);
        for (const n of neighbors) {
            if (testBoard[n] === 0) {
                // 检查这个空点是否落子后成为眼
                if (this.isEyePoint(testBoard, n, color)) {
                    eyeCount++;
                }
            }
        }
        return eyeCount;
    }

    // 检查空点是否被color方完全包围（眼点）
    isEyePoint(board, idx, color) {
        const neighbors = board.getNeighbors(idx);
        for (const n of neighbors) {
            if (board[n] !== color) return false;
        }
        return true;
    }

    // 检查落子是否会填自己的眼
    fillsOwnEye(board, idx, color) {
        if (board.board[idx] !== 0) return false;
        const neighbors = board.getNeighbors(idx);
        for (const n of neighbors) {
            if (board.board[n] !== color) return false;
        }
        // 所有正交邻居都是己方 → 这是眼，不应填
        // 进一步检查对角线确认是否真眼
        const diagonals = this.getDiagonalNeighbors(board, idx);
        const row = Math.floor(idx / this.boardSize);
        const col = idx % this.boardSize;
        const onEdge = (row === 0 || row === this.boardSize - 1 || col === 0 || col === this.boardSize - 1);

        let enemyDiag = 0;
        for (const d of diagonals) {
            if (board.board[d] === 3 - color) enemyDiag++;
        }

        if (onEdge) {
            return enemyDiag === 0; // 边眼：对角无敌方
        }
        return enemyDiag <= 1; // 中央眼：最多1个敌方对角
    }

    // 检查落子是否在己方领地内
    fillsOwnTerritory(board, idx, color) {
        // 用领地计算判断
        const territory = board.calculateTerritoryDetail();
        return territory.map[idx] === color;
    }

    // 评估棋群的眼位安全性
    evaluateGroupEyeSafety(board, testBoard, idx, color) {
        const { group, liberties } = board.findGroupAndLiberties(testBoard, idx);
        if (group.length === 0) return 0;

        // 数该棋群周围有多少眼
        let eyeCount = 0;
        let potentialEyeCount = 0;
        const checkedEmpty = new Set();

        for (const g of group) {
            const neighbors = board.getNeighbors(g);
            for (const n of neighbors) {
                if (testBoard[n] === 0 && !checkedEmpty.has(n)) {
                    checkedEmpty.add(n);
                    if (this.isEyePoint(testBoard, n, color)) {
                        // 进一步确认是否真眼
                        if (this.isEye(board, n, color) || this.isRealEyeOnBoard(testBoard, n, color)) {
                            eyeCount++;
                        } else {
                            potentialEyeCount++;
                        }
                    }
                }
            }
        }

        // 双活眼 = 安全，给大奖励
        if (eyeCount >= 2) return this.weights.groupSafety * 2;
        if (eyeCount === 1) return this.weights.groupSafety * 0.5;
        // 有眼位潜力也给小奖励
        if (potentialEyeCount >= 2) return this.weights.eyeCreation * 0.5;
        if (potentialEyeCount === 1) return this.weights.eyeCreation * 0.2;

        return 0;
    }

    // 在给定棋盘上检查真眼
    isRealEyeOnBoard(board, idx, color) {
        const neighbors = board.getNeighbors(idx);
        for (const n of neighbors) {
            if (board[n] !== color) return false;
        }
        const diagonals = this.getDiagonalNeighbors(board, idx);
        const row = Math.floor(idx / this.boardSize);
        const col = idx % this.boardSize;
        const onEdge = (row === 0 || row === this.boardSize - 1 || col === 0 || col === this.boardSize - 1);

        let enemyDiag = 0;
        for (const d of diagonals) {
            if (board[d] === 3 - color) enemyDiag++;
        }
        if (onEdge) return enemyDiag === 0;
        return enemyDiag <= 1;
    }

    // 评估某个位置的策略价值
    evaluatePosition(board, row, col) {
        let score = 0;
        const player = board.currentPlayer;
        const opponent = 3 - player;
        const i = board.idx(row, col);

        // === 核心惩罚：填自己的眼 ===
        if (this.fillsOwnEye(board, i, player)) {
            score += this.weights.eyeFill;
            // 眼位是绝对不填的，直接返回大惩罚
            return score;
        }

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

        // 4. 打吃对方
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

        // 7. 连接价值（降低权重，避免过度填充）
        score += this.evaluateConnection(board, row, col);

        // 8. 靠近对方棋子
        let approachBonus = 0;
        for (const n of neighbors) {
            if (board.board[n] === opponent) approachBonus += this.weights.approach;
        }
        score += approachBonus;

        // === 9. 眼形评估（新增核心） ===
        // 落子后周围是否形成眼位潜力
        const eyesCreated = this.createsEyePotential(board, i, player);
        if (eyesCreated > 0) {
            score += eyesCreated * this.weights.eyeCreation;
        }

        // === 10. 棋群安全性评估（新增核心） ===
        score += this.evaluateGroupEyeSafety(board, testBoard, i, player);

        // === 11. 领地填充惩罚（新增核心） ===
        if (this.fillsOwnTerritory(board, i, player)) {
            // 在自己领地内落子，惩罚（但不如填眼严重）
            score += this.weights.territoryFill;
        }

        // === 12. 眼位空间保护 ===
        // 如果落子会减少己方棋群的眼位空间，惩罚
        score += this.evaluateEyeSpaceImpact(board, i, player);

        // === 13. 扩展奖励 ===
        // 落子在 neutral 区域扩展势力
        if (this.isExpansionMove(board, i, player)) {
            score += this.weights.expand;
        }

        // === 14. 影响力评估 ===
        score += this.evaluateInfluence(board, testBoard, i, player);

        return score;
    }

    // 评估落子对眼位空间的影响
    evaluateEyeSpaceImpact(board, idx, color) {
        let penalty = 0;
        const neighbors = board.getNeighbors(idx);

        // 检查落子后，附近己方棋群的眼位空间是否减少
        for (const n of neighbors) {
            if (board.board[n] === 0) {
                // 这个空点在落子前是否是己方的潜在眼位？
                const beforeNeighbors = board.getNeighbors(n);
                let friendlyBefore = 0;
                for (const bn of beforeNeighbors) {
                    if (board.board[bn] === color) friendlyBefore++;
                }
                // 如果落子前这个空点有3+己方邻居，它是潜在眼位
                if (friendlyBefore >= 3) {
                    // 落子后会减少这个空点的己方邻居数吗？
                    // 落子前 idx 是空，落子后变成己方 → 反而增加
                    // 但如果 idx 不是这个空点的邻居，则不影响
                    // 这里需要更细致的判断
                    // 实际上 idx 就是 n 的邻居之一，落子前是空，落子后是己方
                    // 所以潜在眼位反而增加了一个己方邻居
                    // 真正的问题是：如果落子把一个空点填了，那个空点本来可能是眼位
                    // 这个检查已经在 fillsOwnEye 中处理了
                }
            }
        }

        // 检查：落子是否把一个"可做眼的空间"分割了
        // 落子前，idx 周围的空位如果是连通的大空间，落子后可能分割它
        const testBoard = new Int8Array(board.board);
        testBoard[idx] = color;

        // 检查落子前 idx 周围的空位连通区大小
        const beforeEmptyRegion = this.measureEmptyRegion(board.board, idx, board);
        const afterEmptyRegions = this.measureEmptyRegionsAfterMove(board.board, idx, color, board);

        // 如果落子前周围有较大的空区域（>3），落子后变小了，说明在分割眼位空间
        if (beforeEmptyRegion >= 4 && afterEmptyRegions.every(r => r < 3)) {
            penalty += this.weights.eyeSpaceProtect * -0.5;
        }

        return penalty;
    }

    // 测量空位连通区大小
    measureEmptyRegion(boardArr, idx, board) {
        if (boardArr[idx] !== 0) return 0;
        const visited = new Set();
        const stack = [idx];
        let count = 0;
        while (stack.length > 0) {
            const cur = stack.pop();
            if (visited.has(cur)) continue;
            if (boardArr[cur] !== 0) continue;
            visited.add(cur);
            count++;
            if (count > 20) return count; // 限制计算量
            const neighbors = board.getNeighbors(cur);
            for (const n of neighbors) {
                if (boardArr[n] === 0 && !visited.has(n)) stack.push(n);
            }
        }
        return count;
    }

    // 落子后测量周围空位连通区
    measureEmptyRegionsAfterMove(boardArr, idx, color, board) {
        const testBoard = new Int8Array(boardArr);
        testBoard[idx] = color;
        const neighbors = board.getNeighbors(idx);
        const regions = [];
        const visited = new Set();
        for (const n of neighbors) {
            if (testBoard[n] === 0 && !visited.has(n)) {
                const stack = [n];
                let count = 0;
                while (stack.length > 0) {
                    const cur = stack.pop();
                    if (visited.has(cur)) continue;
                    if (testBoard[cur] !== 0) continue;
                    visited.add(cur);
                    count++;
                    if (count > 20) break;
                    const nn = board.getNeighbors(cur);
                    for (const x of nn) {
                        if (testBoard[x] === 0 && !visited.has(x)) stack.push(x);
                    }
                }
                regions.push(count);
            }
        }
        return regions;
    }

    // 是否是扩展势力的落子
    isExpansionMove(board, idx, color) {
        const neighbors = board.getNeighbors(idx);
        let friendlyCount = 0;
        let enemyCount = 0;
        let emptyCount = 0;
        for (const n of neighbors) {
            if (board.board[n] === color) friendlyCount++;
            else if (board.board[n] === 3 - color) enemyCount++;
            else emptyCount++;
        }
        // 周围主要是空位，有少量己方棋子 = 扩展
        return emptyCount >= 2 && friendlyCount <= 1 && enemyCount === 0;
    }

    // 影响力评估
    evaluateInfluence(board, testBoard, idx, color) {
        let score = 0;
        const row = Math.floor(idx / this.boardSize);
        const col = idx % this.boardSize;

        // 检查2格范围内的棋子分布
        let influence = 0;
        for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = row + dr;
                const nc = col + dc;
                if (nr < 0 || nr >= this.boardSize || nc < 0 || nc >= this.boardSize) continue;
                const ni = nr * this.boardSize + nc;
                const dist = Math.abs(dr) + Math.abs(dc);
                if (dist === 0) continue;

                if (testBoard[ni] === color) {
                    influence += 0.1 / dist;
                } else if (testBoard[ni] === 3 - color) {
                    influence -= 0.05 / dist;
                }
            }
        }

        score += influence * this.weights.influence;
        return score;
    }

    evaluatePositionalValue(row, col) {
        let score = 0;
        const size = this.boardSize;
        const center = Math.floor(size / 2);
        const distEdge = Math.min(row, col, size - 1 - row, size - 1 - col);

        const starPoints = size === 19
            ? [[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]]
            : [];
        for (const [sr, sc] of starPoints) {
            if (row === sr && col === sc) {
                score += this.weights.starPoint;
                break;
            }
        }

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
        // 只有在连接不同棋群时才奖励，避免单纯填充
        if (friendlyCount === 1) {
            score += this.weights.connection;
        } else if (friendlyCount === 2) {
            // 两边己方 = 可能是好的连接，但也可能是填眼
            // 给较小奖励
            score += this.weights.connection * 0.3;
        }
        // friendlyCount >= 3 时不再给连接奖励（防止填眼动机）
        return score;
    }

    // 选择落子（训练用 - 带温度参数的探索）
    selectMove(board, validMoves, temperature = 0.5) {
        if (validMoves.length === 0) return null;
        if (validMoves.length === 1) return validMoves[0];

        // 计算每个落子的分数
        const scores = validMoves.map(move => this.evaluatePosition(board, move[0], move[1]));

        // 过滤掉填眼的落子（除非所有落子都是填眼）
        const nonEyeFillMoves = [];
        const nonEyeFillScores = [];
        for (let i = 0; i < validMoves.length; i++) {
            if (scores[i] > this.weights.eyeFill) {
                nonEyeFillMoves.push(validMoves[i]);
                nonEyeFillScores.push(scores[i]);
            }
        }

        // 如果有非填眼落子，只用它们
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
            if (useScores[i] > bestScore) {
                bestScore = useScores[i];
                bestIdx = i;
            }
        }
        return useMoves[bestIdx];
    }

    // 从最终结果学习 - 改进版：根据输赢调整眼形相关权重
    learnFromResult(isWin) {
        const lr = this.learningRate;
        const w = this.weights;

        if (isWin) {
            // 赢了 → 强化当前策略，特别是眼形和安全
            w.eyeShape += lr * 0.02;
            w.eyeCreation += lr * 0.02;
            w.eyeFill -= lr * 0.01;     // 更不愿填眼
            w.territoryFill -= lr * 0.01;
            w.groupSafety += lr * 0.02;
            w.expand += lr * 0.01;
        } else {
            // 输了 → 眼形可能不够好，增加造眼意识
            w.eyeShape += lr * 0.03;
            w.eyeCreation += lr * 0.03;
            w.eyeFill -= lr * 0.02;
            w.territoryFill -= lr * 0.02;
            w.groupSafety += lr * 0.03;
            // 降低连接欲望，更多扩张
            w.connection -= lr * 0.01;
            w.expand += lr * 0.02;
        }

        // 权重裁剪
        const keys = Object.keys(w);
        for (const key of keys) {
            w[key] = Math.max(-5, Math.min(5, w[key]));
        }
    }

    // 强化学习奖励更新
    applyReward(gameMoves, winner) {
        if (gameMoves.length === 0) {
            this.learnFromResult(winner === 1);
            return;
        }

        const gamma = 0.95;
        const moveCount = gameMoves.length;

        for (let t = 0; t < moveCount; t++) {
            const move = gameMoves[t];
            const isWinner = (move.player === winner);
            const isLoser = (winner !== 0 && move.player !== winner);

            const temporalWeight = Math.pow(gamma, moveCount - 1 - t);
            const reward = isWinner ? temporalWeight : (isLoser ? -temporalWeight : 0);

            this.experienceBuffer.push({
                state: move.state,
                move: [move.row, move.col],
                player: move.player,
                reward: reward,
                timestamp: t
            });
        }

        if (this.experienceBuffer.length > 1000) {
            this.experienceBuffer = this.experienceBuffer.slice(-1000);
        }

        this.updateWeightsFromExperience();
    }

    updateWeightsFromExperience() {
        if (this.experienceBuffer.length === 0) return;

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

            for (const key in features) {
                gradients[key] = (gradients[key] || 0) + features[key] * exp.reward;
            }
        }

        for (const key in this.weights) {
            if (gradients[key] !== undefined) {
                this.weights[key] += lr * gradients[key] / batchSize;
                this.weights[key] = Math.max(-5, Math.min(5, this.weights[key]));
            }
        }
    }

    // 提取特征向量
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

        // 连接特征（只在1个己方邻居时算）
        let friendlyCount = 0;
        for (const n of neighbors) {
            if (board.board[n] === player) friendlyCount++;
        }
        features.connection = friendlyCount === 1 ? 1 : 0;

        // 靠近对方
        let approachCount = 0;
        for (const n of neighbors) {
            if (board.board[n] === opponent) approachCount++;
        }
        features.approach = approachCount;

        // === 眼形特征（新增核心） ===
        // 是否填自己的眼
        features.eyeFill = this.fillsOwnEye(board, i, player) ? 1 : 0;

        // 是否在自己领地内
        features.territoryFill = this.fillsOwnTerritory(board, i, player) ? 1 : 0;

        // 造眼潜力
        const eyesCreated = this.createsEyePotential(board, i, player);
        features.eyeCreation = eyesCreated;

        // 棋群安全性
        const safety = this.evaluateGroupEyeSafety(board, testBoard, i, player);
        features.groupSafety = safety > 0 ? 1 : 0;

        // 眼形空间保护
        features.eyeSpaceProtect = friendlyCount >= 3 ? -1 : 0;

        // 扩展
        features.expand = this.isExpansionMove(board, i, player) ? 1 : 0;

        // 影响力
        let influence = 0;
        for (const n of neighbors) {
            if (testBoard[n] === 0) influence += 0.5;
        }
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
