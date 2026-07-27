// Eve进化训练器 - G1/G2/G3 + 变异体 + 遗传算法
class EveTrainer {
    constructor(boardSize = 19) {
        this.boardSize = boardSize;
        this.ga = new GeneticAlgorithm(boardSize, 0.15);

        // 模型池
        this.models = {};       // name -> ModelIndividual
        this.modelHistory = [];  // 历史模型

        // 主模型（人机对战用）
        this.bestModel = new PolicyNetwork(boardSize);
        this.mcts = new MCTS(boardSize, 50);
        this.mcts.setPolicyNetwork(this.bestModel);

        // 训练状态
        this.generation = 0;
        this.evoCycle = 0;      // 当前遗传周期（每10代进化一次）
        this.gamesPerGen = 2;   // 每代2局（G3vsG2, G3vs变异G2）
        this.totalGames = 0;
        this.winHistory = [];
        this.isTraining = false;
        this.trainingSpeed = 5;
        this.mutationRate = 15;

        // 回调
        this.onBoardUpdate = null;     // 双棋盘更新: {boardA, boardB, matchA, matchB}
        this.onGameEnd = null;         // 每局结束
        this.onGenEnd = null;          // 每代结束
        this.onEvoEnd = null;          // 每次遗传进化结束
        this.onLog = null;
    }

    setSpeed(speed) {
        this.trainingSpeed = speed;
    }

    setMutationRate(rate) {
        this.mutationRate = rate;
        this.ga.setMutationRate(rate);
    }

    getMoveDelay() {
        return Math.max(0, 200 - this.trainingSpeed * 20);
    }

    // 初始化模型池：G1（初代） G2（当前最佳）
    initModels() {
        const g1 = new ModelIndividual(new PolicyNetwork(this.boardSize), 'G1');
        const g2 = new ModelIndividual(this.bestModel, 'G2');
        g2.network.load(this.bestModel.save());

        this.models = { G1: g1, G2: g2 };
    }

    async startTraining() {
        this.isTraining = true;
        this.initModels();

        while (this.isTraining) {
            this.generation++;
            this.evoCycle++;

            // 创建新生代G3（G2的变异后代）
            const g3Network = this.ga.createOffspring(this.models.G2.network);
            const g3 = new ModelIndividual(g3Network, 'G3');
            this.models.G3 = g3;

            // 创建G2变异体
            const g2MutantNetwork = this.ga.createMutant(this.models.G2.network, this.mutationRate / 100 * 1.5);
            const g2Mutant = new ModelIndividual(g2MutantNetwork, 'G2-Mutant');
            this.models['G2-Mutant'] = g2Mutant;

            // 第1局：G3 vs G2  （黑方G3 vs 白方G2）
            await this.playMatch('G3', 'G2', 1);

            if (!this.isTraining) break;

            // 第2局：G3 vs G2变异体 （黑方G3 vs 白方G2变异体）
            await this.playMatch('G3', 'G2-Mutant', 2);

            if (!this.isTraining) break;

            // 评估G3是否比G2强
            const g3Wins = g3.wins;
            const g2Wins = this.models.G2.wins + this.models['G2-Mutant'].wins;
            const g3Total = g3.wins + g3.losses + g3.draws;
            const g3WinRate = g3Total > 0 ? g3.wins / g3Total : 0;

            this.totalGames += 2;

            // 更新最佳模型
            if (g3WinRate >= 0.5) {
                // G3胜出，成为新的G2
                this.models.G2 = g3;
                this.models.G2.name = 'G2';
                this.bestModel = g3.network;
                this.mcts.setPolicyNetwork(this.bestModel);
                this.modelHistory.push({
                    generation: this.generation,
                    name: 'G2',
                    fitness: g3.fitness,
                    weights: { ...g3.network.weights }
                });
                this.log(`G3 胜出，成为新的G2！ 胜率: ${Math.round(g3WinRate * 100)}%`, 'success');
            } else {
                this.log(`G3 未能超越G2，胜率: ${Math.round(g3WinRate * 100)}%`, 'warning');
            }

            // 记录历史
            this.winHistory.push({
                generation: this.generation,
                g3WinRate: g3WinRate,
                g3Wins: g3Wins,
                totalGames: this.totalGames,
                bestModel: g3WinRate >= 0.5 ? 'G3' : 'G2'
            });

            if (this.onGenEnd) {
                this.onGenEnd({
                    generation: this.generation,
                    g3WinRate: g3WinRate,
                    totalGames: this.totalGames,
                    bestModel: g3WinRate >= 0.5 ? 'G3' : 'G2'
                });
            }

            // 每10代进行一次遗传进化
            if (this.evoCycle >= 10) {
                await this.geneticEvolve();
                this.evoCycle = 0;
            }

            // 自动保存
            if (this.generation % 5 === 0) {
                this.saveToLocalStorage();
            }

            // 等待一下让UI响应
            await new Promise(r => setTimeout(r, 10));
        }

        this.saveToLocalStorage();
    }

    stopTraining() {
        this.isTraining = false;
    }

    // 进行一场对战（同时显示到双棋盘）
    async playMatch(blackName, whiteName, matchNum) {
        const black = this.models[blackName];
        const white = this.models[whiteName];
        const boardA = new GoBoard(this.boardSize); // 显示第1局状态（G3vsG2）
        const boardB = new GoBoard(this.boardSize); // 显示第2局状态（G3vs变异体）

        // 清理上一局
        black.reset();
        white.reset();

        const maxMoves = 220;
        let moveCount = 0;
        let consecutivePasses = 0;

        while (moveCount < maxMoves && this.isTraining) {
            // 当前方落子
            const currentPlayer = boardA.currentPlayer;
            const currentName = currentPlayer === 1 ? blackName : whiteName;
            const currentNetwork = currentPlayer === 1 ? black.network : white.network;

            const validMoves = boardA.getValidMovesFast();

            if (validMoves.length === 0) {
                boardA.pass();
                consecutivePasses++;
                if (consecutivePasses >= 2) break;
                moveCount++;
                continue;
            }

            if (moveCount > 180 && validMoves.length < 5) {
                boardA.pass();
                consecutivePasses++;
                if (consecutivePasses >= 2) break;
                moveCount++;
                continue;
            }

            consecutivePasses = 0;

            // 策略网络选棋
            const temperature = Math.max(0.05, 0.6 - moveCount / 300);
            const move = currentNetwork.selectMove(boardA, validMoves, temperature);

            if (!move) {
                boardA.pass();
                consecutivePasses++;
                if (consecutivePasses >= 2) break;
                moveCount++;
                continue;
            }

            boardA.makeMove(move[0], move[1]);
            moveCount++;

            // 同步显示到对应棋盘
            if (this.onBoardUpdate) {
                this.onBoardUpdate({
                    boardA: matchNum === 1 ? boardA.getState() : null,
                    boardB: matchNum === 2 ? boardA.getState() : null,
                    matchA: matchNum === 1 ? `${blackName} vs ${whiteName}` : null,
                    matchB: matchNum === 2 ? `${blackName} vs ${whiteName}` : null,
                    moveCount: moveCount,
                    currentMatch: matchNum
                });
            }

            const delay = this.getMoveDelay();
            if (delay > 0) {
                await new Promise(r => setTimeout(r, delay));
            } else if (moveCount % 5 === 0) {
                await new Promise(r => setTimeout(r, 0));
            }
        }

        if (!boardA.isGameOver()) {
            boardA.pass();
            boardA.pass();
        }

        const winner = boardA.getWinner();
        const score = boardA.calculateScore();
        const margin = Math.abs(score.black - score.white);

        // 记录结果（黑方视角）
        black.recordGame(winner, winner === 1 ? margin : -margin);
        white.recordGame(3 - winner, winner === 2 ? margin : -margin);

        // 强化学习：双方都从结果学习
        black.network.learnFromResult(winner === 1);
        white.network.learnFromResult(winner === 2);

        if (this.onGameEnd) {
            this.onGameEnd({
                match: matchNum,
                black: blackName,
                white: whiteName,
                winner: winner,
                score: score,
                moves: moveCount,
                generation: this.generation
            });
        }

        const winnerText = winner === 1 ? blackName : winner === 2 ? whiteName : '平局';
        this.log(`第${this.generation}代 对局${matchNum}: ${blackName} vs ${whiteName} → ${winnerText} (黑${score.black.toFixed(1)} vs 白${score.white.toFixed(1)})`, winner === 1 ? 'success' : 'info');
    }

    // 每10代的遗传进化
    async geneticEvolve() {
        this.log(`=== 第${Math.floor(this.generation / 10)}次遗传进化开始 ===`, 'info');

        // 构建种群：当前最佳 + 历史模型 + 若干变异体
        const population = [];
        const scores = [];

        // 加入G2
        population.push(this.models.G2.network);
        scores.push(this.models.G2.fitness + 10); // 精英加成

        // 加入G1
        population.push(this.models.G1.network);
        scores.push(this.models.G1.fitness);

        // 创建5个变异体
        for (let i = 0; i < 5; i++) {
            const mutant = this.ga.createMutant(this.models.G2.network, (10 + i * 5) / 100);
            population.push(mutant);
            scores.push(Math.random() * 5); // 初始随机适应度
        }

        // 种群内部循环对战（每个个体与随机对手打2局）
        for (let round = 0; round < 3 && this.isTraining; round++) {
            for (let i = 0; i < population.length && this.isTraining; i++) {
                const j = Math.floor(Math.random() * population.length);
                if (i === j) continue;

                const result = await this.quickMatch(population[i], population[j]);
                if (result.winner === 1) scores[i] += 2;
                else if (result.winner === 2) scores[j] += 2;
                else { scores[i] += 1; scores[j] += 1; }
            }
            this.log(`进化选拔赛 第${round + 1}轮...`, 'info');
        }

        if (!this.isTraining) return;

        // 遗传进化
        const evoResult = this.ga.evolveGeneration(population, scores);

        // 新的最佳模型
        const newBestNetwork = evoResult.population[0];
        this.models.G2.network = newBestNetwork;
        this.bestModel = newBestNetwork;
        this.mcts.setPolicyNetwork(this.bestModel);

        this.log(`遗传进化完成！新G2适应度: ${evoResult.bestScore.toFixed(2)}`, 'success');

        if (this.onEvoEnd) {
            this.onEvoEnd({
                generation: this.generation,
                bestFitness: evoResult.bestScore
            });
        }
    }

    // 快速对局（不显示UI，仅用于进化评估）
    async quickMatch(blackNetwork, whiteNetwork) {
        const board = new GoBoard(this.boardSize);
        let moves = 0;
        const maxMoves = 150;
        let passes = 0;

        while (moves < maxMoves && !board.isGameOver()) {
            const validMoves = board.getValidMovesFast();
            if (validMoves.length === 0) {
                board.pass();
                passes++;
                if (passes >= 2) break;
                continue;
            }

            if (moves > 140 && validMoves.length < 3) {
                board.pass();
                passes++;
                if (passes >= 2) break;
                continue;
            }

            passes = 0;
            const currentNet = board.currentPlayer === 1 ? blackNetwork : whiteNetwork;
            const move = currentNet.selectMove(board, validMoves, 0.1);
            if (!move) {
                board.pass();
                passes++;
                if (passes >= 2) break;
                continue;
            }

            board.makeMove(move[0], move[1]);
            moves++;
        }

        if (!board.isGameOver()) {
            board.pass();
            board.pass();
        }

        const winner = board.getWinner();
        const score = board.calculateScore();
        return { winner, score };
    }

    // ===== 人机对战 =====
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

    // ===== 保存/加载 =====
    getSaveData() {
        return {
            version: '3.0',
            boardSize: this.boardSize,
            generation: this.generation,
            evoCycle: this.evoCycle,
            totalGames: this.totalGames,
            winHistory: this.winHistory,
            bestModel: this.bestModel.save(),
            mutationRate: this.mutationRate,
            modelHistory: this.modelHistory.slice(-20),
            timestamp: Date.now()
        };
    }

    saveToLocalStorage() {
        try {
            localStorage.setItem('eve-go-evo-model', JSON.stringify(this.getSaveData()));
        } catch (e) {
            console.error('保存失败:', e);
        }
    }

    async loadLatestModel() {
        let saved = localStorage.getItem('eve-go-evo-model');
        if (!saved) saved = localStorage.getItem('eve-go-19-model');
        if (!saved) saved = localStorage.getItem('eve-go-last-model');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.loadTrainingData(data);
                return true;
            } catch (e) {
                console.error('加载失败:', e);
                return false;
            }
        }
        return false;
    }

    loadTrainingData(data) {
        if (data.bestModel) {
            this.bestModel.load(data.bestModel);
            this.mcts.setPolicyNetwork(this.bestModel);
        }
        if (data.generation !== undefined) this.generation = data.generation;
        if (data.evoCycle !== undefined) this.evoCycle = data.evoCycle;
        if (data.totalGames !== undefined) this.totalGames = data.totalGames;
        if (data.winHistory) this.winHistory = data.winHistory;
        if (data.mutationRate) {
            this.mutationRate = data.mutationRate;
            this.ga.setMutationRate(data.mutationRate);
        }
        if (data.modelHistory) this.modelHistory = data.modelHistory;
        if (data.boardSize) this.boardSize = data.boardSize;

        // 重建模型池
        this.initModels();
        this.models.G2.network = this.bestModel;
    }

    getTrainingStats() {
        const recent = this.winHistory.slice(-10);
        const avgG3WinRate = recent.length > 0
            ? recent.reduce((sum, h) => sum + h.g3WinRate, 0) / recent.length
            : 0;
        return {
            generation: this.generation,
            evoCycle: this.evoCycle,
            totalGames: this.totalGames,
            avgG3WinRate: avgG3WinRate,
            winHistory: this.winHistory,
            bestModelWeights: { ...this.bestModel.weights }
        };
    }

    getModelRanking() {
        const ranking = [];
        if (this.models.G2) {
            ranking.push({ name: 'G2 (最佳)', score: this.models.G2.fitness.toFixed(1) });
        }
        if (this.models.G3) {
            ranking.push({ name: 'G3 (新生代)', score: this.models.G3.fitness.toFixed(1) });
        }
        if (this.models.G1) {
            ranking.push({ name: 'G1 (初代)', score: this.models.G1.fitness.toFixed(1) });
        }
        if (this.models['G2-Mutant']) {
            ranking.push({ name: 'G2-Mutant', score: this.models['G2-Mutant'].fitness ? this.models['G2-Mutant'].fitness.toFixed(1) : '0.0' });
        }
        return ranking.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));
    }

    log(msg, type) {
        if (this.onLog) this.onLog(msg, type);
    }
}