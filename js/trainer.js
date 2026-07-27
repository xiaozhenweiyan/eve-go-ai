class EveTrainer {
    constructor(boardSize = 9) {
        this.boardSize = boardSize;
        this.policyNetwork = new PolicyNetwork(boardSize);
        this.mcts = new MCTS(boardSize, 200);
        this.mcts.setPolicyNetwork(this.policyNetwork);
        
        this.generation = 0;
        this.gamesPlayed = 0;
        this.winHistory = [];
        this.trainingData = [];
        this.isTraining = false;
        this.trainingSpeed = 1;
        this.onGameEnd = null;
        this.onUpdate = null;
    }

    async startTraining(gamesPerGeneration = 10, iterations = 200) {
        this.isTraining = true;
        this.mcts.iterations = iterations;
        
        while (this.isTraining) {
            this.generation++;
            let generationWins = 0;
            
            for (let i = 0; i < gamesPerGeneration && this.isTraining; i++) {
                const result = await this.playGame(true);
                if (result === 1) generationWins++;
                this.gamesPlayed++;
                
                if (this.onUpdate) {
                    this.onUpdate({
                        generation: this.generation,
                        game: i + 1,
                        totalGames: this.gamesPlayed,
                        progress: ((i + 1) / gamesPerGeneration) * 100,
                        currentResult: result
                    });
                }

                await new Promise(r => setTimeout(r, 100 / this.trainingSpeed));
            }

            this.winHistory.push({
                generation: this.generation,
                wins: generationWins,
                total: gamesPerGeneration,
                winRate: generationWins / gamesPerGeneration
            });

            this.updatePolicyNetwork();
            this.saveTrainingData();

            if (this.onGameEnd) {
                this.onGameEnd({
                    generation: this.generation,
                    winRate: generationWins / gamesPerGeneration,
                    totalGames: this.gamesPlayed
                });
            }
        }
    }

    stopTraining() {
        this.isTraining = false;
    }

    async playGame(isTraining = false) {
        const board = new GoBoard(this.boardSize);
        const moves = [];
        let passes = 0;

        while (!board.isGameOver()) {
            const validMoves = board.getValidMoves();
            
            if (validMoves.length === 0) {
                board.pass();
                passes++;
                continue;
            }

            const move = this.mcts.getBestMove(board);
            
            if (!move) {
                board.pass();
                passes++;
                continue;
            }

            board.makeMove(move[0], move[1]);
            moves.push({
                player: board.currentPlayer === 1 ? 2 : 1,
                row: move[0],
                col: move[1],
                state: board.getState()
            });
            passes = 0;

            if (!isTraining && this.onUpdate) {
                this.onUpdate({ board: board.getState() });
                await new Promise(r => setTimeout(r, 500));
            }
        }

        const winner = board.getWinner();
        
        if (isTraining) {
            this.trainingData.push({
                winner,
                moves,
                finalState: board.getState(),
                score: board.calculateScore(),
                generation: this.generation
            });
        }

        return winner;
    }

    updatePolicyNetwork() {
        if (this.trainingData.length === 0) return;

        const recentGames = this.trainingData.slice(-10);
        let blackWins = 0;
        let whiteWins = 0;

        for (const game of recentGames) {
            if (game.winner === 1) blackWins++;
            else if (game.winner === 2) whiteWins++;
        }

        const result = blackWins > whiteWins ? 1 : 2;
        this.policyNetwork.updateWeights(result, recentGames);

        this.learningRateDecay();
    }

    learningRateDecay() {
        if (this.generation % 10 === 0) {
            this.policyNetwork.learningRate *= 0.95;
        }
    }

    saveTrainingData() {
        const data = {
            generation: this.generation,
            gamesPlayed: this.gamesPlayed,
            winHistory: this.winHistory,
            policyNetwork: this.policyNetwork.save(),
            trainingData: this.trainingData.slice(-50),
            timestamp: Date.now()
        };

        try {
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `eve-go-model-gen-${this.generation}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Failed to save model:', e);
        }

        localStorage.setItem('eve-go-last-model', JSON.stringify(data));
    }

    loadTrainingData(data) {
        if (data.policyNetwork) {
            this.policyNetwork.load(data.policyNetwork);
        }
        if (data.generation !== undefined) {
            this.generation = data.generation;
        }
        if (data.gamesPlayed !== undefined) {
            this.gamesPlayed = data.gamesPlayed;
        }
        if (data.winHistory) {
            this.winHistory = data.winHistory;
        }
        if (data.trainingData) {
            this.trainingData = data.trainingData;
        }

        this.mcts.setPolicyNetwork(this.policyNetwork);
    }

    async loadLatestModel() {
        const saved = localStorage.getItem('eve-go-last-model');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.loadTrainingData(data);
                return true;
            } catch (e) {
                console.error('Failed to load model:', e);
                return false;
            }
        }
        return false;
    }

    getAIResponse(board, difficulty = 'medium') {
        let iterations = 200;
        
        switch (difficulty) {
            case 'easy': iterations = 50; break;
            case 'medium': iterations = 200; break;
            case 'hard': iterations = 500; break;
        }

        return this.mcts.getBestMove(board, iterations);
    }

    getTrainingStats() {
        const recent = this.winHistory.slice(-10);
        const avgWinRate = recent.length > 0 
            ? recent.reduce((sum, h) => sum + h.winRate, 0) / recent.length 
            : 0;

        return {
            generation: this.generation,
            gamesPlayed: this.gamesPlayed,
            recentWinRate: avgWinRate,
            winHistory: this.winHistory,
            weights: { ...this.policyNetwork.weights }
        };
    }
}