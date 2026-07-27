// Eve训练器 - 自学习对弈 + 强化学习
class EveTrainer {
    constructor(boardSize = 19) {
        this.boardSize = boardSize;
        this.policyNetwork = new PolicyNetwork(boardSize);
        this.mcts = new MCTS(boardSize, 50);
        this.mcts.setPolicyNetwork(this.policyNetwork);

        this.generation = 0;
        this.gamesPlayed = 0;
        this.winHistory = [];
        this.trainingData = [];
        this.isTraining = false;
        this.trainingSpeed = 5; // 1-10

        // 回调
        this.onMove = null;      // 每步落子回调
        this.onGameEnd = null;   // 每局结束回调
        this.onGeneration = null; // 每代结束回调
        this.onLog = null;       // 日志回调
    }

    setSpeed(speed) {
        this.trainingSpeed = speed;
    }

    // 每步延迟（毫秒），速度越大延迟越小
    getMoveDelay() {
        return Math.max(0, 220 - this.trainingSpeed * 22);
    }

    async startTraining(gamesPerGeneration = 3) {
        this.isTraining = true;

        while (this.isTraining) {
            this.generation++;
            let blackWins = 0;
            let whiteWins = 0;
            let draws = 0;

            for (let g = 0; g < gamesPerGeneration && this.isTraining; g++) {
                if (this.onLog) this.onLog(`第${this.generation}代 第${g + 1}/${gamesPerGeneration}局开始`, 'info');

                const result = await this.playSelfPlayGame(g + 1);

                if (result.winner === 1) blackWins++;
                else if (result.winner === 2) whiteWins++;
                else draws++;

                this.gamesPlayed++;

                if (this.onGameEnd) {
                    this.onGameEnd({
                        generation: this.generation,
                        game: g + 1,
                        winner: result.winner,
                        score: result.score,
                        moves: result.moves.length,
                        totalGames: this.gamesPlayed
                    });
                }
            }

            if (!this.isTraining) break;

            const blackWinRate = blackWins / gamesPerGeneration;
            this.winHistory.push({
                generation: this.generation,
                blackWins,
                whiteWins,
                draws,
                total: gamesPerGeneration,
                blackWinRate: blackWinRate
            });

            // 学习率衰减
            if (this.generation % 5 === 0) {
                this.policyNetwork.learningRate *= 0.95;
            }

            // 自动保存
            this.saveToLocalStorage();

            if (this.onGeneration) {
                this.onGeneration({
                    generation: this.generation,
                    blackWins,
                    whiteWins,
                    draws,
                    blackWinRate: blackWinRate,
                    totalGames: this.gamesPlayed,
                    weights: { ...this.policyNetwork.weights }
                });
            }

            if (this.onLog) {
                this.onLog(`第${this.generation}代完成 - 黑胜${blackWins} 白胜${whiteWins} 平${draws}`, 'success');
            }
        }
    }

    stopTraining() {
        this.isTraining = false;
    }

    // 自对弈一局 - 使用策略网络直接落子（不用MCTS，保证速度）
    async playSelfPlayGame(gameNum) {
        const board = new GoBoard(this.boardSize);
        const moves = [];
        const maxMoves = 250; // 19路围棋最大手数限制
        let consecutivePasses = 0;

        for (let step = 0; step < maxMoves && this.isTraining; step++) {
            const validMoves = board.getValidMovesFast();

            if (validMoves.length === 0) {
                board.pass();
                consecutivePasses++;
                if (consecutivePasses >= 2) break;
                continue;
            }

            // 判断是否应该pass（剩余有效落子很少且棋盘接近终局）
            if (step > 150 && validMoves.length < 5) {
                board.pass();
                consecutivePasses++;
                if (consecutivePasses >= 2) break;
                continue;
            }

            consecutivePasses = 0;

            // 使用策略网络选择落子（带探索温度）
            const temperature = Math.max(0.1, 0.8 - step / 200); // 随着手数增加降低探索
            const move = this.policyNetwork.selectMove(board, validMoves, temperature);

            if (!move) {
                board.pass();
                consecutivePasses++;
                if (consecutivePasses >= 2) break;
                continue;
            }

            const player = board.currentPlayer;
            board.makeMove(move[0], move[1]);

            // 记录这一步
            moves.push({
                player: player,
                row: move[0],
                col: move[1],
                state: board.getState(),
                step: step
            });

            // 通知UI更新
            if (this.onMove) {
                this.onMove({
                    board: board.getState(),
                    move: move,
                    player: player,
                    step: step + 1,
                    game: gameNum,
                    generation: this.generation
                });
            }

            // 让出UI线程
            const delay = this.getMoveDelay();
            if (delay > 0) {
                await new Promise(r => setTimeout(r, delay));
            } else {
                // 即使延迟为0也要偶尔让出，否则UI会卡死
                if (step % 5 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                }
            }
        }

        // 如果游戏没结束，强制结束
        if (!board.isGameOver()) {
            board.pass();
            board.pass();
        }

        const winner = board.getWinner();
        const score = board.calculateScore();

        // 强化学习：根据结果更新策略网络权重
        this.policyNetwork.applyReward(moves, winner);

        // 保存训练数据
        this.trainingData.push({
            winner,
            score,
            moves: moves.length,
            generation: this.generation,
            timestamp: Date.now()
        });

        // 限制训练数据大小
        if (this.trainingData.length > 200) {
            this.trainingData = this.trainingData.slice(-200);
        }

        return { winner, score, moves };
    }

    // 人机对战用：MCTS搜索
    getAIResponse(board, difficulty = 'medium') {
        let iterations;
        switch (difficulty) {
            case 'easy': iterations = 20; break;
            case 'medium': iterations = 60; break;
            case 'hard': iterations = 150; break;
            default: iterations = 60;
        }
        return this.mcts.getBestMove(board, iterations);
    }

    saveToLocalStorage() {
        const data = this.getSaveData();
        try {
            localStorage.setItem('eve-go-19-model', JSON.stringify(data));
        } catch (e) {
            console.error('保存到localStorage失败:', e);
        }
    }

    getSaveData() {
        return {
            version: '2.0',
            boardSize: this.boardSize,
            generation: this.generation,
            gamesPlayed: this.gamesPlayed,
            winHistory: this.winHistory,
            policyNetwork: this.policyNetwork.save(),
            trainingData: this.trainingData.slice(-50),
            timestamp: Date.now()
        };
    }

    loadTrainingData(data) {
        if (data.policyNetwork) {
            this.policyNetwork.load(data.policyNetwork);
            this.mcts.setPolicyNetwork(this.policyNetwork);
        }
        if (data.generation !== undefined) this.generation = data.generation;
        if (data.gamesPlayed !== undefined) this.gamesPlayed = data.gamesPlayed;
        if (data.winHistory) this.winHistory = data.winHistory;
        if (data.trainingData) this.trainingData = data.trainingData;
        if (data.boardSize) this.boardSize = data.boardSize;
    }

    async loadLatestModel() {
        // 先尝试19路模型
        let saved = localStorage.getItem('eve-go-19-model');
        if (!saved) saved = localStorage.getItem('eve-go-last-model'); // 兼容旧版
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.loadTrainingData(data);
                return true;
            } catch (e) {
                console.error('加载模型失败:', e);
                return false;
            }
        }
        return false;
    }

    getTrainingStats() {
        const recent = this.winHistory.slice(-10);
        const avgWinRate = recent.length > 0
            ? recent.reduce((sum, h) => sum + h.blackWinRate, 0) / recent.length
            : 0;
        return {
            generation: this.generation,
            gamesPlayed: this.gamesPlayed,
            recentWinRate: avgWinRate,
            winHistory: this.winHistory,
            weights: { ...this.policyNetwork.weights },
            learningRate: this.policyNetwork.learningRate,
            experienceCount: this.policyNetwork.experienceBuffer.length
        };
    }
}