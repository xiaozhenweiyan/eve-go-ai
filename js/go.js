class GoBoard {
    constructor(size = 9) {
        this.size = size;
        this.board = [];
        this.currentPlayer = 1;
        this.history = [];
        this.previousBoardHash = null;
        this.passCount = 0;
        this.blackCaptures = 0;
        this.whiteCaptures = 0;
        this.initBoard();
    }

    initBoard() {
        this.board = [];
        for (let i = 0; i < this.size; i++) {
            this.board[i] = [];
            for (let j = 0; j < this.size; j++) {
                this.board[i][j] = 0;
            }
        }
        this.currentPlayer = 1;
        this.history = [];
        this.previousBoardHash = null;
        this.passCount = 0;
        this.blackCaptures = 0;
        this.whiteCaptures = 0;
    }

    getState() {
        return {
            board: this.board.map(row => [...row]),
            currentPlayer: this.currentPlayer,
            blackCaptures: this.blackCaptures,
            whiteCaptures: this.whiteCaptures,
            passCount: this.passCount,
            history: [...this.history]
        };
    }

    setState(state) {
        this.board = state.board.map(row => [...row]);
        this.currentPlayer = state.currentPlayer;
        this.blackCaptures = state.blackCaptures;
        this.whiteCaptures = state.whiteCaptures;
        this.passCount = state.passCount;
        this.history = [...state.history];
        this.previousBoardHash = this.history.length > 0 ? this.getBoardHash(this.history[this.history.length - 1].board) : null;
    }

    clone() {
        const clone = new GoBoard(this.size);
        clone.setState(this.getState());
        return clone;
    }

    getBoardHash(board) {
        let hash = '';
        for (let i = 0; i < this.size; i++) {
            for (let j = 0; j < this.size; j++) {
                hash += board[i][j].toString();
            }
        }
        return hash;
    }

    isValidMove(row, col) {
        if (row < 0 || row >= this.size || col < 0 || col >= this.size) {
            return false;
        }
        if (this.board[row][col] !== 0) {
            return false;
        }

        const testBoard = this.board.map(r => [...r]);
        testBoard[row][col] = this.currentPlayer;

        const captured = this.findCapturedStones(testBoard, 3 - this.currentPlayer);
        if (captured.length > 0) {
            for (const [cr, cc] of captured) {
                testBoard[cr][cc] = 0;
            }
        }

        if (!this.hasLiberties(testBoard, row, col)) {
            return false;
        }

        const newHash = this.getBoardHash(testBoard);
        if (newHash === this.previousBoardHash) {
            return false;
        }

        return true;
    }

    getValidMoves() {
        const moves = [];
        for (let i = 0; i < this.size; i++) {
            for (let j = 0; j < this.size; j++) {
                if (this.isValidMove(i, j)) {
                    moves.push([i, j]);
                }
            }
        }
        return moves;
    }

    findGroup(board, row, col) {
        const color = board[row][col];
        if (color === 0) return [];

        const group = [];
        const visited = new Set();
        const stack = [[row, col]];

        while (stack.length > 0) {
            const [r, c] = stack.pop();
            const key = `${r},${c}`;
            
            if (visited.has(key)) continue;
            if (r < 0 || r >= this.size || c < 0 || c >= this.size) continue;
            if (board[r][c] !== color) continue;

            visited.add(key);
            group.push([r, c]);

            stack.push([r - 1, c]);
            stack.push([r + 1, c]);
            stack.push([r, c - 1]);
            stack.push([r, c + 1]);
        }

        return group;
    }

    getLiberties(board, row, col) {
        const group = this.findGroup(board, row, col);
        const liberties = new Set();

        for (const [r, c] of group) {
            const neighbors = [
                [r - 1, c], [r + 1, c],
                [r, c - 1], [r, c + 1]
            ];

            for (const [nr, nc] of neighbors) {
                if (nr >= 0 && nr < this.size && nc >= 0 && nc < this.size) {
                    if (board[nr][nc] === 0) {
                        liberties.add(`${nr},${nc}`);
                    }
                }
            }
        }

        return liberties.size;
    }

    hasLiberties(board, row, col) {
        return this.getLiberties(board, row, col) > 0;
    }

    findCapturedStones(board, color) {
        const captured = [];
        const checked = new Set();

        for (let i = 0; i < this.size; i++) {
            for (let j = 0; j < this.size; j++) {
                if (board[i][j] === color) {
                    const key = `${i},${j}`;
                    if (checked.has(key)) continue;

                    const group = this.findGroup(board, i, j);
                    group.forEach(([r, c]) => checked.add(`${r},${c}`));

                    if (!this.hasLiberties(board, i, j)) {
                        captured.push(...group);
                    }
                }
            }
        }

        return captured;
    }

    makeMove(row, col) {
        if (!this.isValidMove(row, col)) {
            return false;
        }

        this.history.push({
            board: this.board.map(r => [...r]),
            currentPlayer: this.currentPlayer,
            blackCaptures: this.blackCaptures,
            whiteCaptures: this.whiteCaptures,
            passCount: this.passCount
        });

        this.board[row][col] = this.currentPlayer;

        const captured = this.findCapturedStones(this.board, 3 - this.currentPlayer);
        for (const [cr, cc] of captured) {
            this.board[cr][cc] = 0;
        }

        if (this.currentPlayer === 1) {
            this.blackCaptures += captured.length;
        } else {
            this.whiteCaptures += captured.length;
        }

        this.previousBoardHash = this.getBoardHash(this.history[this.history.length - 1].board);
        this.currentPlayer = 3 - this.currentPlayer;
        this.passCount = 0;

        return true;
    }

    pass() {
        this.history.push({
            board: this.board.map(r => [...r]),
            currentPlayer: this.currentPlayer,
            blackCaptures: this.blackCaptures,
            whiteCaptures: this.whiteCaptures,
            passCount: this.passCount
        });

        this.currentPlayer = 3 - this.currentPlayer;
        this.passCount++;

        return true;
    }

    isGameOver() {
        return this.passCount >= 2;
    }

    calculateScore() {
        const territory = this.calculateTerritory();
        const blackScore = territory.black + this.blackCaptures + 6.5;
        const whiteScore = territory.white + this.whiteCaptures;
        return { black: blackScore, white: whiteScore };
    }

    calculateTerritory() {
        const visited = new Set();
        let blackTerritory = 0;
        let whiteTerritory = 0;

        for (let i = 0; i < this.size; i++) {
            for (let j = 0; j < this.size; j++) {
                if (this.board[i][j] === 0 && !visited.has(`${i},${j}`)) {
                    const emptyGroup = [];
                    const borders = new Set();
                    const stack = [[i, j]];

                    while (stack.length > 0) {
                        const [r, c] = stack.pop();
                        const key = `${r},${c}`;

                        if (visited.has(key)) continue;
                        if (r < 0 || r >= this.size || c < 0 || c >= this.size) continue;

                        if (this.board[r][c] === 0) {
                            visited.add(key);
                            emptyGroup.push([r, c]);
                            stack.push([r - 1, c]);
                            stack.push([r + 1, c]);
                            stack.push([r, c - 1]);
                            stack.push([r, c + 1]);
                        } else {
                            borders.add(this.board[r][c]);
                        }
                    }

                    if (borders.size === 1) {
                        const owner = borders.values().next().value;
                        if (owner === 1) {
                            blackTerritory += emptyGroup.length;
                        } else {
                            whiteTerritory += emptyGroup.length;
                        }
                    }
                }
            }
        }

        return { black: blackTerritory, white: whiteTerritory };
    }

    getWinner() {
        if (!this.isGameOver()) return null;
        const score = this.calculateScore();
        if (score.black > score.white) return 1;
        if (score.white > score.black) return 2;
        return 0;
    }
}