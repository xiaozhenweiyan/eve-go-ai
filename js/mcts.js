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

    getUCB1(explorationWeight = Math.sqrt(2)) {
        if (this.visits === 0) return Infinity;
        const exploitation = this.wins / this.visits;
        const exploration = explorationWeight * Math.sqrt(Math.log(this.parent.visits) / this.visits);
        return exploitation + exploration + this.policyValue * 0.1;
    }
}

class MCTS {
    constructor(boardSize = 9, iterations = 1000) {
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
            const winner = this.simulate(node);
            this.backpropagate(node, winner);
        }

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
        const board = new GoBoard(this.boardSize);
        board.setState(node.state);
        const validMoves = board.getValidMoves();

        for (const move of validMoves) {
            const childBoard = board.clone();
            childBoard.makeMove(move[0], move[1]);
            const childNode = new MCTSNode(childBoard.getState(), move, node);
            
            if (this.policyNetwork) {
                childNode.policyValue = this.policyNetwork.evaluate(childBoard);
            }
            
            node.children.push(childNode);
        }
        
        node.expanded = true;
    }

    simulate(node) {
        const board = new GoBoard(this.boardSize);
        board.setState(node.state);

        let passes = 0;
        let moves = 0;
        const maxMoves = this.boardSize * this.boardSize * 2;

        while (!board.isGameOver() && moves < maxMoves) {
            const validMoves = board.getValidMoves();
            
            if (validMoves.length === 0) {
                board.pass();
                passes++;
                continue;
            }

            const move = this.getRandomMove(board, validMoves);
            board.makeMove(move[0], move[1]);
            passes = 0;
            moves++;
        }

        return board.getWinner();
    }

    getRandomMove(board, validMoves) {
        if (this.policyNetwork && Math.random() < 0.7) {
            const scores = validMoves.map(move => {
                const testBoard = board.clone();
                testBoard.makeMove(move[0], move[1]);
                return this.policyNetwork.evaluate(testBoard);
            });
            
            const maxScore = Math.max(...scores);
            const bestMoves = validMoves.filter((_, i) => scores[i] === maxScore);
            return bestMoves[Math.floor(Math.random() * bestMoves.length)];
        }
        
        return validMoves[Math.floor(Math.random() * validMoves.length)];
    }

    backpropagate(node, winner) {
        while (node !== null) {
            node.visits++;
            const currentPlayer = node.state.currentPlayer;
            if (winner === currentPlayer) {
                node.wins++;
            } else if (winner !== 0) {
                node.wins += 0.01;
            } else {
                node.wins += 0.5;
            }
            node = node.parent;
        }
    }

    getMoveDistribution() {
        if (!this.root || this.root.children.length === 0) return [];
        
        const totalVisits = this.root.children.reduce((sum, child) => sum + child.visits, 0);
        
        return this.root.children.map(child => ({
            move: child.move,
            visits: child.visits,
            probability: totalVisits > 0 ? child.visits / totalVisits : 0
        }));
    }
}

class PolicyNetwork {
    constructor(boardSize = 9) {
        this.boardSize = boardSize;
        this.weights = this.initializeWeights();
        this.learningRate = 0.1;
    }

    initializeWeights() {
        const weights = {};
        weights.captureWeight = 0.5;
        weights.libertyWeight = 0.3;
        weights.territoryWeight = 0.2;
        weights.centerWeight = 0.1;
        weights.cornerWeight = 0.15;
        weights.edgeWeight = 0.08;
        weights.proximityWeight = 0.2;
        return weights;
    }

    evaluate(board) {
        let score = 0;
        
        const validMoves = board.getValidMoves();
        if (validMoves.length === 0) return 0;

        for (const [row, col] of validMoves) {
            score += this.evaluateMove(board, row, col);
        }

        return score / validMoves.length;
    }

    evaluateMove(board, row, col) {
        let score = 0;
        const currentPlayer = board.currentPlayer;

        const testBoard = board.clone();
        testBoard.makeMove(row, col);

        const captured = testBoard.findCapturedStones(testBoard.board, 3 - currentPlayer);
        score += captured.length * this.weights.captureWeight * 10;

        const liberties = testBoard.getLiberties(testBoard.board, row, col);
        score += liberties * this.weights.libertyWeight;

        const territoryBonus = this.calculateTerritoryBonus(row, col);
        score += territoryBonus * this.weights.territoryWeight;

        const positionBonus = this.calculatePositionBonus(row, col);
        score += positionBonus;

        const proximityBonus = this.calculateProximityBonus(board, row, col);
        score += proximityBonus * this.weights.proximityWeight;

        return score;
    }

    calculateTerritoryBonus(row, col) {
        const center = (this.boardSize - 1) / 2;
        const distToCenter = Math.sqrt(Math.pow(row - center, 2) + Math.pow(col - center, 2));
        return Math.max(0, (this.boardSize / 2) - distToCenter);
    }

    calculatePositionBonus(row, col) {
        const isCorner = (row === 0 || row === this.boardSize - 1) && 
                         (col === 0 || col === this.boardSize - 1);
        const isEdge = (row === 0 || row === this.boardSize - 1 || 
                        col === 0 || col === this.boardSize - 1) && !isCorner;

        if (isCorner) return this.weights.cornerWeight * 5;
        if (isEdge) return this.weights.edgeWeight * 3;
        return this.weights.centerWeight * 2;
    }

    calculateProximityBonus(board, row, col) {
        let bonus = 0;
        const neighbors = [
            [row - 1, col], [row + 1, col],
            [row, col - 1], [row, col + 1],
            [row - 1, col - 1], [row - 1, col + 1],
            [row + 1, col - 1], [row + 1, col + 1]
        ];

        for (const [nr, nc] of neighbors) {
            if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize) {
                if (board.board[nr][nc] === board.currentPlayer) {
                    bonus += 1;
                } else if (board.board[nr][nc] !== 0) {
                    bonus += 0.5;
                }
            }
        }

        return bonus;
    }

    updateWeights(gameResult, moves) {
        const learningRate = this.learningRate;
        
        if (gameResult === 1) {
            this.weights.captureWeight += learningRate * 0.01;
            this.weights.libertyWeight += learningRate * 0.005;
        } else if (gameResult === 2) {
            this.weights.territoryWeight += learningRate * 0.01;
            this.weights.centerWeight += learningRate * 0.005;
        }

        for (const weight in this.weights) {
            this.weights[weight] = Math.max(0, Math.min(1, this.weights[weight]));
        }
    }

    save() {
        return {
            boardSize: this.boardSize,
            weights: { ...this.weights },
            learningRate: this.learningRate
        };
    }

    load(data) {
        this.boardSize = data.boardSize || this.boardSize;
        this.weights = data.weights || this.weights;
        this.learningRate = data.learningRate || this.learningRate;
    }
}