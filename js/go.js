// 围棋核心规则 - 使用扁平Int8Array优化性能
class GoBoard {
    constructor(size = 19) {
        this.size = size;
        this.totalSize = size * size;
        this.initBoard();
    }

    initBoard() {
        // 使用Int8Array提升性能: 0=空, 1=黑, 2=白
        this.board = new Int8Array(this.totalSize);
        this.currentPlayer = 1;
        this.history = [];
        this.previousBoardHash = null;
        this.passCount = 0;
        this.blackCaptures = 0;
        this.whiteCaptures = 0;
        this.moveCount = 0;
        // 劫争状态
        this.koPoint = null;           // 当前劫点（对方刚提1子，本方不能立即回提）
        this.koPlayer = 0;              // 劫争限制方（谁不能立即回提）
        this.lastCapturedPoint = null;  // 上一步被提的点（用于判断劫）
    }

    idx(row, col) {
        return row * this.size + col;
    }

    getState() {
        return {
            board: Array.from(this.board),
            currentPlayer: this.currentPlayer,
            blackCaptures: this.blackCaptures,
            whiteCaptures: this.whiteCaptures,
            passCount: this.passCount,
            moveCount: this.moveCount,
            koPoint: this.koPoint,
            koPlayer: this.koPlayer,
            lastCapturedPoint: this.lastCapturedPoint
        };
    }

    setState(state) {
        this.board = new Int8Array(state.board);
        this.currentPlayer = state.currentPlayer;
        this.blackCaptures = state.blackCaptures;
        this.whiteCaptures = state.whiteCaptures;
        this.passCount = state.passCount;
        this.moveCount = state.moveCount || 0;
        this.koPoint = state.koPoint || null;
        this.koPlayer = state.koPlayer || 0;
        this.lastCapturedPoint = state.lastCapturedPoint || null;
        this.previousBoardHash = this.history.length > 0
            ? this.hashBoard(new Int8Array(this.history[this.history.length - 1].board))
            : null;
    }

    clone() {
        const clone = new GoBoard(this.size);
        clone.board = new Int8Array(this.board);
        clone.currentPlayer = this.currentPlayer;
        clone.blackCaptures = this.blackCaptures;
        clone.whiteCaptures = this.whiteCaptures;
        clone.passCount = this.passCount;
        clone.moveCount = this.moveCount;
        clone.previousBoardHash = this.previousBoardHash;
        clone.history = this.history.map(h => ({ ...h, board: Array.from(h.board) }));
        clone.koPoint = this.koPoint;
        clone.koPlayer = this.koPlayer;
        clone.lastCapturedPoint = this.lastCapturedPoint;
        return clone;
    }

    hashBoard(board) {
        let hash = '';
        for (let i = 0; i < this.totalSize; i++) {
            hash += board[i];
        }
        return hash;
    }

    // 获取相邻位置的索引
    getNeighbors(idx) {
        const neighbors = [];
        const row = Math.floor(idx / this.size);
        const col = idx % this.size;
        if (row > 0) neighbors.push(idx - this.size);
        if (row < this.size - 1) neighbors.push(idx + this.size);
        if (col > 0) neighbors.push(idx - 1);
        if (col < this.size - 1) neighbors.push(idx + 1);
        return neighbors;
    }

    // 查找一个棋子所在的连通组及其气数
    findGroupAndLiberties(board, idx) {
        const color = board[idx];
        if (color === 0) return { group: [], liberties: 0 };

        const group = [];
        const visited = new Set();
        const libertySet = new Set();
        const stack = [idx];

        while (stack.length > 0) {
            const cur = stack.pop();
            if (visited.has(cur)) continue;
            visited.add(cur);
            group.push(cur);

            const neighbors = this.getNeighbors(cur);
            for (const n of neighbors) {
                if (board[n] === 0) {
                    libertySet.add(n);
                } else if (board[n] === color && !visited.has(n)) {
                    stack.push(n);
                }
            }
        }

        return { group, liberties: libertySet.size };
    }

    isValidMove(row, col) {
        if (row < 0 || row >= this.size || col < 0 || col >= this.size) return false;
        const i = this.idx(row, col);
        if (this.board[i] !== 0) return false;

        // 劫争规则：不能立即回提劫点
        if (this.koPoint === i && this.koPlayer === this.currentPlayer) {
            return false;
        }

        const testBoard = new Int8Array(this.board);
        testBoard[i] = this.currentPlayer;
        const opponent = 3 - this.currentPlayer;

        // 只检查相邻的对方棋子组是否被提
        let captured = 0;
        let capturedPoint = null;
        const neighbors = this.getNeighbors(i);
        const checked = new Set();
        for (const n of neighbors) {
            if (testBoard[n] === opponent && !checked.has(n)) {
                const { group, liberties } = this.findGroupAndLiberties(testBoard, n);
                group.forEach(g => checked.add(g));
                if (liberties === 0) {
                    captured += group.length;
                    for (const g of group) {
                        testBoard[g] = 0;
                    }
                    // 记录被提的点
                    if (group.length === 1) {
                        capturedPoint = group[0];
                    }
                }
            }
        }

        // 自杀规则
        const { liberties: myLiberties } = this.findGroupAndLiberties(testBoard, i);
        if (myLiberties === 0 && captured === 0) return false;

        // 劫争检查 - 仅在恰好提1子时才需要检查（劫争只在这种情况发生）
        if (captured === 1 && this.previousBoardHash !== null) {
            const newHash = this.hashBoard(testBoard);
            if (newHash === this.previousBoardHash) return false;
        }

        return true;
    }

    // 检查是否有劫争机会（制造劫材威胁）
    hasKoThreat() {
        return this.koPoint !== null;
    }

    // 获取劫点位置
    getKoPoint() {
        return this.koPoint;
    }

    // 清除劫争状态
    clearKo() {
        this.koPoint = null;
        this.koPlayer = 0;
        this.lastCapturedPoint = null;
    }

    getValidMoves() {
        const moves = [];
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const i = this.idx(row, col);
                if (this.board[i] === 0 && this.isValidMove(row, col)) {
                    moves.push([row, col]);
                }
            }
        }
        return moves;
    }

    // 快速获取有效落子 - 包含已有棋子周围2格范围内的空位
    getValidMovesFast() {
        // 开局阶段（前10步）允许全盘落子
        if (this.moveCount < 10) {
            const moves = [];
            for (let row = 0; row < this.size; row++) {
                for (let col = 0; col < this.size; col++) {
                    if (this.board[this.idx(row, col)] === 0 && this.isValidMove(row, col)) {
                        moves.push([row, col]);
                    }
                }
            }
            return moves;
        }

        // 中盘只检查已有棋子周围2格范围
        const candidates = new Set();
        for (let i = 0; i < this.totalSize; i++) {
            if (this.board[i] !== 0) {
                const row = Math.floor(i / this.size);
                const col = i % this.size;
                // 检查周围2格
                for (let dr = -2; dr <= 2; dr++) {
                    for (let dc = -2; dc <= 2; dc++) {
                        const nr = row + dr;
                        const nc = col + dc;
                        if (nr >= 0 && nr < this.size && nc >= 0 && nc < this.size) {
                            const ni = this.idx(nr, nc);
                            if (this.board[ni] === 0) candidates.add(ni);
                        }
                    }
                }
            }
        }

        const moves = [];
        for (const i of candidates) {
            const row = Math.floor(i / this.size);
            const col = i % this.size;
            if (this.isValidMove(row, col)) {
                moves.push([row, col]);
            }
        }
        return moves;
    }

    makeMove(row, col) {
        if (!this.isValidMove(row, col)) return false;

        // 保存历史
        this.history.push({
            board: Array.from(this.board),
            currentPlayer: this.currentPlayer,
            blackCaptures: this.blackCaptures,
            whiteCaptures: this.whiteCaptures,
            passCount: this.passCount,
            moveCount: this.moveCount,
            koPoint: this.koPoint,
            koPlayer: this.koPlayer,
            lastCapturedPoint: this.lastCapturedPoint
        });

        const i = this.idx(row, col);
        this.board[i] = this.currentPlayer;
        const opponent = 3 - this.currentPlayer;

        // 提子
        const neighbors = this.getNeighbors(i);
        const checked = new Set();
        let totalCaptured = 0;
        let capturedPoint = null;
        let capturedByThisMove = [];

        for (const n of neighbors) {
            if (this.board[n] === opponent && !checked.has(n)) {
                const { group, liberties } = this.findGroupAndLiberties(this.board, n);
                group.forEach(g => checked.add(g));
                if (liberties === 0) {
                    for (const g of group) {
                        this.board[g] = 0;
                        capturedByThisMove.push(g);
                    }
                    totalCaptured += group.length;
                    if (group.length === 1) {
                        capturedPoint = group[0];
                    }
                }
            }
        }

        if (this.currentPlayer === 1) this.blackCaptures += totalCaptured;
        else this.whiteCaptures += totalCaptured;

        // 设置劫争状态
        // 如果恰好提1子，且落子点气数为1（会被对方立即回提），则形成劫争
        const { liberties: myLiberties } = this.findGroupAndLiberties(this.board, i);
        if (totalCaptured === 1 && capturedPoint !== null && myLiberties === 1) {
            // 形成劫争：对方不能立即回提 capturedPoint（落子点i）
            this.koPoint = capturedPoint;
            this.koPlayer = opponent;
            this.lastCapturedPoint = i;
        } else {
            // 非劫争情况，清除劫争状态
            this.koPoint = null;
            this.koPlayer = 0;
            this.lastCapturedPoint = null;
        }

        this.previousBoardHash = this.hashBoard(new Int8Array(this.history[this.history.length - 1].board));
        this.currentPlayer = opponent;
        this.passCount = 0;
        this.moveCount++;

        return true;
    }

    pass() {
        this.history.push({
            board: Array.from(this.board),
            currentPlayer: this.currentPlayer,
            blackCaptures: this.blackCaptures,
            whiteCaptures: this.whiteCaptures,
            passCount: this.passCount,
            moveCount: this.moveCount,
            koPoint: this.koPoint,
            koPlayer: this.koPlayer,
            lastCapturedPoint: this.lastCapturedPoint
        });
        this.currentPlayer = 3 - this.currentPlayer;
        this.passCount++;
        this.moveCount++;
        // pass 后劫争状态清除
        this.koPoint = null;
        this.koPlayer = 0;
        this.lastCapturedPoint = null;
        return true;
    }

    isGameOver() {
        return this.passCount >= 2;
    }

    calculateScore() {
        const territory = this.calculateTerritory();
        const komi = 6.5;
        const blackScore = territory.black + this.blackCaptures;
        const whiteScore = territory.white + this.whiteCaptures + komi;
        return { black: blackScore, white: whiteScore, komi, blackTerritory: territory.black, whiteTerritory: territory.white };
    }

    // 返回目数信息（包含差值）用于UI显示
    calculatePoints() {
        const score = this.calculateScore();
        const blackPoints = score.black;
        const whitePoints = score.white;
        const diff = Math.abs(blackPoints - whitePoints);
        const leading = blackPoints > whitePoints ? '黑' : (whitePoints > blackPoints ? '白' : '均');
        return { black: blackPoints, white: whitePoints, diff, leading, komi: score.komi };
    }

    calculateTerritory() {
        const visited = new Set();
        let blackTerritory = 0;
        let whiteTerritory = 0;

        for (let i = 0; i < this.totalSize; i++) {
            if (this.board[i] === 0 && !visited.has(i)) {
                const emptyGroup = [];
                const borders = new Set();
                const stack = [i];

                while (stack.length > 0) {
                    const cur = stack.pop();
                    if (visited.has(cur)) continue;
                    if (this.board[cur] !== 0) {
                        borders.add(this.board[cur]);
                        continue;
                    }
                    visited.add(cur);
                    emptyGroup.push(cur);
                    const neighbors = this.getNeighbors(cur);
                    for (const n of neighbors) stack.push(n);
                }

                if (borders.size === 1) {
                    const owner = borders.values().next().value;
                    if (owner === 1) blackTerritory += emptyGroup.length;
                    else whiteTerritory += emptyGroup.length;
                }
            }
        }

        return { black: blackTerritory, white: whiteTerritory };
    }

    // 返回每个交叉点的领地归属 (0=无主, 1=黑, 2=白)
    calculateTerritoryDetail() {
        const visited = new Set();
        const territoryMap = new Int8Array(this.totalSize);

        for (let i = 0; i < this.totalSize; i++) {
            if (this.board[i] === 0 && !visited.has(i)) {
                const emptyGroup = [];
                const borders = new Set();
                const stack = [i];

                while (stack.length > 0) {
                    const cur = stack.pop();
                    if (visited.has(cur)) continue;
                    if (this.board[cur] !== 0) {
                        borders.add(this.board[cur]);
                        continue;
                    }
                    visited.add(cur);
                    emptyGroup.push(cur);
                    const neighbors = this.getNeighbors(cur);
                    for (const n of neighbors) stack.push(n);
                }

                if (borders.size === 1) {
                    const owner = borders.values().next().value;
                    for (const idx of emptyGroup) {
                        territoryMap[idx] = owner;
                    }
                }
            }
        }

        return { map: territoryMap, black: 0, white: 0 };
    }

    getWinner() {
        if (!this.isGameOver()) return null;
        const score = this.calculateScore();
        if (score.black > score.white) return 1;
        if (score.white > score.black) return 2;
        return 0;
    }
}