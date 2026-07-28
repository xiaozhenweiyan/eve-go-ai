// Eve 种群进化训练器 - 200个AI互相随机对战
class EveTrainer {
    constructor(boardSize = 19, populationSize = 200) {
        this.boardSize = boardSize;
        this.populationSize = populationSize;
        this.ga = new GeneticAlgorithm(boardSize, 0.12);

        // 200个AI种群
        this.population = [];
        this.initPopulation();

        // 当前最佳（人机对战用）
        this.bestIdx = 0;
        this.mcts = new MCTS(boardSize, 50);
        this.mcts.setPolicyNetwork(this.population[0].network);

        // 训练状态
        this.generation = 0;      // 遗传代数
        this.totalGames = 0;      // 总对局数
        this.isTraining = false;
        this.isPaused = false;
        this.trainingSpeed = 5;

        // 观看目标：-1 = 自动(Top AI), >=0 = 指定AI索引
        this.watchedAiIdx = -1;

        // 后台对局计数器（用于控制展示对局频率）
        this.backgroundCount = 0;
        this.showcaseInterval = 3; // 每3局后台对局后运行1局展示对局

        // 当前展示对局（用于UI显示）
        this.showcaseMatchA = null;   // 棋盘A：精选对局
        this.showcaseMatchB = null;   // 棋盘B：Top1 vs Top2 模拟

        // 历史快照（用于图表）
        this.winRateHistory = [];   // 每N局记录一次所有AI的胜率

        // 回调
        this.onBoardUpdate = null;
        this.onMatchEnd = null;
        this.onStatsUpdate = null;
        this.onLog = null;
    }

    initPopulation() {
        this.population = [];
        for (let i = 0; i < this.populationSize; i++) {
            this.population.push({
                name: `G${i + 1}`,
                network: new PolicyNetwork(this.boardSize),
                wins: 0,
                losses: 0,
                draws: 0,
                totalGames: 0,
                winRate: 0,
                fitness: 0,
                generation: 0
            });
        }
    }

    setSpeed(speed) { this.trainingSpeed = speed; }

    setWatchedAi(idx) {
        this.watchedAiIdx = idx;
    }

    getMoveDelay() {
        return Math.max(0, 180 - this.trainingSpeed * 18);
    }

    // 获取按胜率排序的索引
    getSortedIndices() {
        return this.population
            .map((p, i) => ({ idx: i, winRate: p.winRate, fitness: p.fitness, totalGames: p.totalGames }))
            .sort((a, b) => b.winRate - a.winRate || b.fitness - a.fitness)
            .map(x => x.idx);
    }

    getTopIndices(n = 20) {
        return this.getSortedIndices().slice(0, n);
    }

    // 随机选择对手（确保不同）
    selectRandomOpponents() {
        let idx1 = Math.floor(Math.random() * this.populationSize);
        let idx2 = Math.floor(Math.random() * this.populationSize);
        while (idx2 === idx1) {
            idx2 = Math.floor(Math.random() * this.populationSize);
        }
        return [idx1, idx2];
    }

    // 选择展示对局的对手（高胜率AI或 watched AI）
    selectShowcaseOpponents() {
        // 如果有 watched AI，优先让它参与
        if (this.watchedAiIdx >= 0 && this.watchedAiIdx < this.populationSize) {
            const otherIdx = this.selectRandomOpponentExcluding(this.watchedAiIdx);
            if (Math.random() < 0.5) {
                return [this.watchedAiIdx, otherIdx];
            } else {
                return [otherIdx, this.watchedAiIdx];
            }
        }

        // 否则从Top 10中选择两个对战
        const top = this.getTopIndices(10);
        const i1 = top[Math.floor(Math.random() * Math.min(5, top.length))];
        let i2 = top[Math.floor(Math.random() * top.length)];
        let safety = 0;
        while (i2 === i1 && safety < 20) {
            i2 = top[Math.floor(Math.random() * top.length)];
            safety++;
        }
        if (i2 === i1) {
            i2 = this.selectRandomOpponentExcluding(i1);
        }
        return [i1, i2];
    }

    selectRandomOpponentExcluding(excludeIdx) {
        let idx = Math.floor(Math.random() * this.populationSize);
        let safety = 0;
        while (idx === excludeIdx && safety < 100) {
            idx = Math.floor(Math.random() * this.populationSize);
            safety++;
        }
        return idx;
    }

    // 主训练循环
    async startTraining() {
        this.isTraining = true;
        this.isPaused = false;
        this.backgroundCount = 0;

        while (this.isTraining) {
            if (this.isPaused) {
                await new Promise(r => setTimeout(r, 100));
                continue;
            }

            let idx1, idx2, result;

            // 决定运行后台对局还是展示对局
            const runShowcase = this.backgroundCount >= this.showcaseInterval;

            if (runShowcase) {
                [idx1, idx2] = this.selectShowcaseOpponents();
                result = await this.playShowcaseMatch(idx1, idx2);
                this.backgroundCount = 0;
            } else {
                [idx1, idx2] = this.selectRandomOpponents();
                result = await this.playBackgroundMatch(idx1, idx2);
                this.backgroundCount++;
            }

            this.totalGames++;

            // 更新统计
            this.updateStats(idx1, idx2, result);

            // 更新最佳模型（人机对战用）
            const topIdx = this.getSortedIndices()[0];
            if (topIdx !== this.bestIdx) {
                this.bestIdx = topIdx;
                this.mcts.setPolicyNetwork(this.population[topIdx].network);
            }

            // 每10局：遗传进化 + 保存胜率快照
            if (this.totalGames % 10 === 0) {
                this.generation++;
                this.saveWinRateSnapshot();
                await this.geneticEvolve();
                if (this.onStatsUpdate) this.onStatsUpdate(this.getStats());
            }

            // 每5局更新一次排行榜
            if (this.totalGames % 5 === 0) {
                if (this.onStatsUpdate) this.onStatsUpdate(this.getStats());
            }

            // 每50局自动保存
            if (this.totalGames % 50 === 0) {
                this.saveToLocalStorage();
            }

            // 小暂停让UI响应
            await new Promise(r => setTimeout(r, 2));
        }

        this.saveToLocalStorage();
    }

    stopTraining() {
        this.isTraining = false;
        this.isPaused = false;
    }

    pauseTraining() {
        this.isPaused = !this.isPaused;
        return this.isPaused;
    }

    // 后台对局：快速完成，不通知UI
    async playBackgroundMatch(idx1, idx2) {
        const board = new GoBoard(this.boardSize);
        const blackNet = this.population[idx1].network;
        const whiteNet = this.population[idx2].network;
        const maxMoves = 220;
        let passes = 0;

        for (let step = 0; step < maxMoves; step++) {
            const validMoves = board.getValidMovesFast();

            if (validMoves.length === 0) {
                board.pass();
                passes++;
                if (passes >= 2) break;
                continue;
            }

            if (step > 180 && validMoves.length < 5) {
                board.pass();
                passes++;
                if (passes >= 2) break;
                continue;
            }

            passes = 0;

            const currentNet = board.currentPlayer === 1 ? blackNet : whiteNet;
            const move = currentNet.selectMove(board, validMoves, 0.1);

            if (!move) {
                board.pass();
                passes++;
                if (passes >= 2) break;
                continue;
            }

            board.makeMove(move[0], move[1]);

            // 每10步让出一次UI线程
            if (step % 10 === 0) {
                await new Promise(r => setTimeout(r, 0));
            }
        }

        if (!board.isGameOver()) {
            board.pass();
            board.pass();
        }

        const winner = board.getWinner();
        const score = board.calculateScore();

        // 强化学习
        blackNet.learnFromResult(winner === 1);
        whiteNet.learnFromResult(winner === 2);

        return { winner, score, moves: board.moveCount };
    }

    // 展示对局：正常速度，更新两个棋盘
    async playShowcaseMatch(idx1, idx2) {
        const black = this.population[idx1];
        const white = this.population[idx2];
        const boardA = new GoBoard(this.boardSize);

        this.showcaseMatchA = { blackIdx: idx1, whiteIdx: idx2, board: boardA };

        // 棋盘B：Top1 vs Top2 模拟对局
        const topIndices = this.getTopIndices(2);
        const boardB = new GoBoard(this.boardSize);
        // 确保两个Top AI不同
        let topBWhiteIdx = topIndices[1];
        if (topBWhiteIdx === topIndices[0]) {
            topBWhiteIdx = this.selectRandomOpponentExcluding(topIndices[0]);
        }
        this.showcaseMatchB = {
            blackIdx: topIndices[0],
            whiteIdx: topBWhiteIdx,
            board: boardB
        };

        const maxMoves = 220;
        let moveCount = 0;
        let passesA = 0;

        for (let step = 0; step < maxMoves && this.isTraining && !this.isPaused; step++) {
            // === 棋盘A：精选对局走一步 ===
            const validMovesA = boardA.getValidMovesFast();
            if (validMovesA.length === 0) {
                boardA.pass();
                passesA++;
                if (passesA >= 2) break;
            } else if (step > 180 && validMovesA.length < 5) {
                boardA.pass();
                passesA++;
                if (passesA >= 2) break;
            } else {
                passesA = 0;
                const currentNetA = boardA.currentPlayer === 1 ? black.network : white.network;
                const temperature = Math.max(0.05, 0.5 - step / 350);
                const moveA = currentNetA.selectMove(boardA, validMovesA, temperature);
                if (moveA) {
                    boardA.makeMove(moveA[0], moveA[1]);
                } else {
                    boardA.pass();
                    passesA++;
                    if (passesA >= 2) break;
                }
            }

            // === 棋盘B：Top模拟对局同步走一步 ===
            this.simulateShowcaseBStep();

            moveCount++;

            // 通知UI更新两个棋盘
            if (this.onBoardUpdate) {
                this.onBoardUpdate({
                    showcaseA: this.getShowcaseAState(),
                    showcaseB: this.getShowcaseBState(),
                    totalGames: this.totalGames,
                    isShowcase: true
                });
            }

            const delay = this.getMoveDelay();
            if (delay > 0) {
                await new Promise(r => setTimeout(r, delay));
            } else if (step % 3 === 0) {
                await new Promise(r => setTimeout(r, 0));
            }
        }

        if (!boardA.isGameOver()) {
            boardA.pass();
            boardA.pass();
        }

        const winner = boardA.getWinner();
        const score = boardA.calculateScore();

        // 强化学习
        black.network.learnFromResult(winner === 1);
        white.network.learnFromResult(winner === 2);

        if (this.onMatchEnd) {
            this.onMatchEnd({
                black: black.name,
                white: white.name,
                winner: winner,
                score: score,
                moves: moveCount,
                totalGames: this.totalGames,
                isShowcase: true
            });
        }

        // 重置棋盘B以便下一场展示对局
        this.showcaseMatchB = null;

        return { winner, score, moves: moveCount };
    }

    // 棋盘B走一步（Top AI模拟）
    simulateShowcaseBStep() {
        if (!this.showcaseMatchB) return;
        const tm = this.showcaseMatchB;
        const board = tm.board;
        if (board.isGameOver()) return;

        const validMoves = board.getValidMovesFast();
        if (validMoves.length === 0) {
            board.pass();
            return;
        }

        const currentNet = board.currentPlayer === 1
            ? this.population[tm.blackIdx].network
            : this.population[tm.whiteIdx].network;
        const move = currentNet.selectMove(board, validMoves, 0.1);
        if (move) {
            board.makeMove(move[0], move[1]);
        } else {
            board.pass();
        }
    }

    getShowcaseAState() {
        if (!this.showcaseMatchA) return null;
        const tm = this.showcaseMatchA;
        const board = tm.board;
        return {
            board: board.getState(),
            blackName: this.population[tm.blackIdx].name,
            whiteName: this.population[tm.whiteIdx].name,
            blackScore: board.calculateScore().black,
            whiteScore: board.calculateScore().white,
            moveCount: board.moveCount
        };
    }

    getShowcaseBState() {
        if (!this.showcaseMatchB) return null;
        const tm = this.showcaseMatchB;
        const board = tm.board;
        return {
            board: board.getState(),
            blackName: this.population[tm.blackIdx].name,
            whiteName: this.population[tm.whiteIdx].name,
            blackScore: board.calculateScore().black,
            whiteScore: board.calculateScore().white,
            moveCount: board.moveCount
        };
    }

    updateStats(idx1, idx2, result) {
        const black = this.population[idx1];
        const white = this.population[idx2];
        const winner = result.winner;

        if (winner === 1) {
            black.wins++;
            white.losses++;
        } else if (winner === 2) {
            white.wins++;
            black.losses++;
        } else {
            black.draws++;
            white.draws++;
        }

        black.totalGames++;
        white.totalGames++;

        black.winRate = black.totalGames > 0 ? black.wins / black.totalGames : 0;
        white.winRate = white.totalGames > 0 ? white.wins / white.totalGames : 0;

        // 适应度 = 胜率 * 100 + 对局数加成（鼓励多对战）
        black.fitness = black.winRate * 100 + Math.min(10, black.totalGames / 10);
        white.fitness = white.winRate * 100 + Math.min(10, white.totalGames / 10);
    }

    // 遗传进化（每10局）
    async geneticEvolve() {
        this.log(`=== 第${this.generation}代遗传进化 ===`, 'info');

        const sorted = this.getSortedIndices();
        const eliteCount = 10;  // 保留前10名
        const newPopulation = [];

        // 精英保留
        for (let i = 0; i < eliteCount; i++) {
            const elite = this.population[sorted[i]];
            newPopulation.push({
                name: elite.name,
                network: this.cloneNetwork(elite.network),
                wins: elite.wins,
                losses: elite.losses,
                draws: elite.draws,
                totalGames: elite.totalGames,
                winRate: elite.winRate,
                fitness: elite.fitness,
                generation: this.generation
            });
        }

        //  Tournament Selection + Crossover + Mutation 产生新个体
        while (newPopulation.length < this.populationSize) {
            // 锦标赛选择
            const p1 = this.tournamentSelect(sorted, 5);
            const p2 = this.tournamentSelect(sorted, 5);

            // 交叉
            const offspring = this.ga.createOffspring(p1.network, p2.network);

            newPopulation.push({
                name: `G${newPopulation.length + 1}`,
                network: offspring,
                wins: 0,
                losses: 0,
                draws: 0,
                totalGames: 0,
                winRate: 0,
                fitness: 0,
                generation: this.generation
            });
        }

        this.population = newPopulation;
        this.log(`遗传进化完成，保留前${eliteCount}名精英`, 'success');
    }

    tournamentSelect(sortedIndices, tournamentSize) {
        let bestIdx = sortedIndices[Math.floor(Math.random() * Math.min(tournamentSize, sortedIndices.length))];
        let bestFitness = this.population[bestIdx].fitness;
        for (let i = 1; i < tournamentSize; i++) {
            const idx = sortedIndices[Math.floor(Math.random() * sortedIndices.length)];
            if (this.population[idx].fitness > bestFitness) {
                bestFitness = this.population[idx].fitness;
                bestIdx = idx;
            }
        }
        return this.population[bestIdx];
    }

    cloneNetwork(network) {
        const clone = new PolicyNetwork(this.boardSize);
        clone.load(network.save());
        return clone;
    }

    // 保存胜率快照（用于图表）
    saveWinRateSnapshot() {
        const winRates = this.population.map(p => p.winRate);
        const sorted = [...winRates].sort((a, b) => b - a);
        this.winRateHistory.push({
            generation: this.generation,
            totalGames: this.totalGames,
            all: winRates,
            top10: sorted.slice(0, 10),
            top50: sorted.slice(0, 50),
            avg: winRates.reduce((a, b) => a + b, 0) / winRates.length,
            median: sorted[Math.floor(sorted.length / 2)]
        });
        // 限制历史长度
        if (this.winRateHistory.length > 100) {
            this.winRateHistory = this.winRateHistory.slice(-100);
        }
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

    // ===== 统计 =====
    getStats() {
        const sorted = this.getSortedIndices();
        const top10 = sorted.slice(0, 10).map(i => ({
            name: this.population[i].name,
            winRate: this.population[i].winRate,
            totalGames: this.population[i].totalGames,
            fitness: this.population[i].fitness,
            idx: i
        }));
        const allWinRates = this.population.map(p => p.winRate);
        const avgWinRate = allWinRates.reduce((a, b) => a + b, 0) / allWinRates.length;
        return {
            generation: this.generation,
            totalGames: this.totalGames,
            top10: top10,
            avgWinRate: avgWinRate,
            winRateHistory: this.winRateHistory,
            bestName: this.population[sorted[0]].name,
            bestWinRate: this.population[sorted[0]].winRate,
            watchedAiIdx: this.watchedAiIdx
        };
    }

    // ===== 保存/加载 =====
    getSaveData() {
        return {
            version: '5.0',
            boardSize: this.boardSize,
            populationSize: this.populationSize,
            generation: this.generation,
            totalGames: this.totalGames,
            population: this.population.map(p => ({
                name: p.name,
                network: p.network.save(),
                wins: p.wins,
                losses: p.losses,
                draws: p.draws,
                totalGames: p.totalGames,
                winRate: p.winRate,
                fitness: p.fitness,
                generation: p.generation
            })),
            winRateHistory: this.winRateHistory,
            timestamp: Date.now()
        };
    }

    saveToLocalStorage() {
        try {
            const data = this.getSaveData();
            // 只保存前50名+随机50名以控制大小
            const sorted = this.getSortedIndices();
            const keepIndices = new Set([...sorted.slice(0, 50)]);
            while (keepIndices.size < 100) {
                keepIndices.add(Math.floor(Math.random() * this.populationSize));
            }
            const compactData = {
                ...data,
                population: data.population.filter((_, i) => keepIndices.has(i)),
                _compact: true,
                _keptIndices: Array.from(keepIndices)
            };
            localStorage.setItem('eve-go-200-model', JSON.stringify(compactData));
        } catch (e) {
            console.error('保存失败:', e);
        }
    }

    async loadLatestModel() {
        const saved = localStorage.getItem('eve-go-200-model');
        if (!saved) return false;
        try {
            const data = JSON.parse(saved);
            this.loadTrainingData(data);
            return true;
        } catch (e) {
            console.error('加载失败:', e);
            return false;
        }
    }

    loadTrainingData(data) {
        if (data.population && data.population.length > 0) {
            // 如果数据是压缩的，需要重建200个
            if (data._compact && data._keptIndices) {
                this.population = [];
                const keptMap = {};
                data._keptIndices.forEach((idx, i) => {
                    keptMap[idx] = data.population[i];
                });
                for (let i = 0; i < this.populationSize; i++) {
                    if (keptMap[i]) {
                        const p = keptMap[i];
                        const net = new PolicyNetwork(this.boardSize);
                        net.load(p.network);
                        this.population.push({
                            name: p.name,
                            network: net,
                            wins: p.wins || 0,
                            losses: p.losses || 0,
                            draws: p.draws || 0,
                            totalGames: p.totalGames || 0,
                            winRate: p.winRate || 0,
                            fitness: p.fitness || 0,
                            generation: p.generation || 0
                        });
                    } else {
                        this.population.push({
                            name: `G${i + 1}`,
                            network: new PolicyNetwork(this.boardSize),
                            wins: 0, losses: 0, draws: 0,
                            totalGames: 0, winRate: 0, fitness: 0, generation: 0
                        });
                    }
                }
            } else {
                this.population = data.population.map(p => {
                    const net = new PolicyNetwork(this.boardSize);
                    net.load(p.network);
                    return {
                        name: p.name,
                        network: net,
                        wins: p.wins || 0,
                        losses: p.losses || 0,
                        draws: p.draws || 0,
                        totalGames: p.totalGames || 0,
                        winRate: p.winRate || 0,
                        fitness: p.fitness || 0,
                        generation: p.generation || 0
                    };
                });
            }
        }
        if (data.generation !== undefined) this.generation = data.generation;
        if (data.totalGames !== undefined) this.totalGames = data.totalGames;
        if (data.winRateHistory) this.winRateHistory = data.winRateHistory;

        // 更新最佳模型
        const sorted = this.getSortedIndices();
        this.bestIdx = sorted[0];
        this.mcts.setPolicyNetwork(this.population[this.bestIdx].network);
    }

    log(msg, type) {
        if (this.onLog) this.onLog(msg, type);
    }
}
