// Eve 种群进化训练器 - 400个AI / 20种族 互相随机对战
class EveTrainer {
    constructor(boardSize = 19, populationSize = 400) {
        this.boardSize = boardSize;
        this.populationSize = populationSize;
        this.ga = new GeneticAlgorithm(boardSize, 0.12);

        // 400个AI种群
        this.population = [];
        this.speciesCount = 20;
        this.maxSpecies = 30;
        this.speciesBaseWeights = [];
        this.speciesStats = [];
        this.speciesHistory = []; // 种族数量历史（用于图表）
        this.initPopulation();

        // 当前最佳（人机对战用）
        this.bestIdx = 0;
        this.mcts = new MCTS(boardSize, 50);
        this.mcts.setPolicyNetwork(this.population[0].network);

        // 训练状态
        this.generation = 0;
        this.totalGames = 0;
        this.isTraining = false;
        this.isPaused = false;
        this.trainingSpeed = 5;

        // 观看目标
        this.watchedAiIdx = -1;

        // 后台/展示对局
        this.backgroundCount = 0;
        this.showcaseInterval = 3;

        this.showcaseMatchA = null;
        this.showcaseMatchB = null;

        // 历史快照
        this.winRateHistory = [];

        // 回调
        this.onBoardUpdate = null;
        this.onMatchEnd = null;
        this.onStatsUpdate = null;
        this.onLog = null;
    }

    initPopulation() {
        this.population = [];
        this.speciesBaseWeights = [];

        // 创建20个种族的基础参数模板
        for (let s = 0; s < this.speciesCount; s++) {
            const baseNet = new PolicyNetwork(this.boardSize);
            this.ga.mutate(baseNet, 0.4);
            this.speciesBaseWeights.push({ ...baseNet.weights });
        }

        // 每个种族20个AI
        const perSpecies = this.populationSize / this.speciesCount; // 400/20=20
        for (let i = 0; i < this.populationSize; i++) {
            const species = Math.floor(i / perSpecies);
            const network = new PolicyNetwork(this.boardSize);
            network.weights = { ...this.speciesBaseWeights[species] };
            this.ga.mutate(network, 0.05);

            this.population.push({
                name: `G${i + 1}`,
                network: network,
                species: species,
                wins: 0, losses: 0, draws: 0,
                totalGames: 0, winRate: 0, fitness: 0,
                generation: 0
            });
        }

        // 初始化种族统计
        this.speciesStats = [];
        for (let s = 0; s < this.maxSpecies; s++) {
            const count = s < this.speciesCount ? perSpecies : 0;
            this.speciesStats.push({
                population: count,
                totalWins: 0,
                totalLosses: 0,
                totalGames: 0,
                winRate: 0.5,
                losingStreak: 0
            });
        }
    }

    // 重置全部数据
    resetAll() {
        this.stopTraining();
        this.generation = 0;
        this.totalGames = 0;
        this.isTraining = false;
        this.isPaused = false;
        this.watchedAiIdx = -1;
        this.backgroundCount = 0;
        this.showcaseMatchA = null;
        this.showcaseMatchB = null;
        this.winRateHistory = [];
        this.speciesHistory = [];
        this.initPopulation();
        this.bestIdx = 0;
        this.mcts.setPolicyNetwork(this.population[0].network);
        // 清除本地存储
        localStorage.removeItem('eve-go-400-model');
    }

    setSpeed(speed) { this.trainingSpeed = speed; }
    setWatchedAi(idx) { this.watchedAiIdx = idx; }

    getMoveDelay() {
        return Math.max(0, 180 - this.trainingSpeed * 18);
    }

    getSortedIndices() {
        return this.population
            .map((p, i) => ({ idx: i, winRate: p.winRate, fitness: p.fitness, totalGames: p.totalGames }))
            .sort((a, b) => b.winRate - a.winRate || b.fitness - a.fitness)
            .map(x => x.idx);
    }

    getTopIndices(n = 20) {
        return this.getSortedIndices().slice(0, n);
    }

    selectRandomOpponents() {
        let idx1 = Math.floor(Math.random() * this.populationSize);
        let idx2 = Math.floor(Math.random() * this.populationSize);
        while (idx2 === idx1) {
            idx2 = Math.floor(Math.random() * this.populationSize);
        }
        return [idx1, idx2];
    }

    selectShowcaseOpponents() {
        if (this.watchedAiIdx >= 0 && this.watchedAiIdx < this.populationSize) {
            const otherIdx = this.selectRandomOpponentExcluding(this.watchedAiIdx);
            if (Math.random() < 0.5) return [this.watchedAiIdx, otherIdx];
            return [otherIdx, this.watchedAiIdx];
        }
        const top = this.getTopIndices(10);
        const i1 = top[Math.floor(Math.random() * Math.min(5, top.length))];
        let i2 = top[Math.floor(Math.random() * top.length)];
        let safety = 0;
        while (i2 === i1 && safety < 20) {
            i2 = top[Math.floor(Math.random() * top.length)];
            safety++;
        }
        if (i2 === i1) i2 = this.selectRandomOpponentExcluding(i1);
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

    // 检查是否应该投子认输（每20步检查一次以节省性能）
    shouldResign(board) {
        if (board.moveCount < 60) return false;
        if (board.moveCount % 20 !== 0) return false;
        const score = board.calculateScore();
        const diff = board.currentPlayer === 1
            ? score.white - score.black
            : score.black - score.white;
        return diff > 35;
    }

    // 收官判断：局势已定时主动停手
    isEndgameSettled(board) {
        // 150步以后才考虑收官
        if (board.moveCount < 150) return false;
        const validMoves = board.getValidMovesFast();
        // 有效落子点极少 = 大局已定
        if (validMoves.length < 5) return true;
        // 如果只剩不到10个落子点且都在某一方领地内
        if (validMoves.length < 10 && board.moveCount > 200) return true;
        return false;
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
            this.updateStats(idx1, idx2, result);

            const topIdx = this.getSortedIndices()[0];
            if (topIdx !== this.bestIdx) {
                this.bestIdx = topIdx;
                this.mcts.setPolicyNetwork(this.population[topIdx].network);
            }

            if (this.totalGames % 10 === 0) {
                this.generation++;
                this.saveWinRateSnapshot();
                this.saveSpeciesSnapshot();
                await this.geneticEvolve();
                if (this.onStatsUpdate) this.onStatsUpdate(this.getStats());
            }

            if (this.totalGames % 5 === 0) {
                if (this.onStatsUpdate) this.onStatsUpdate(this.getStats());
            }

            if (this.totalGames % 50 === 0) {
                this.saveToLocalStorage();
            }

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
        let passes = 0;
        let resigned = 0;

        for (let step = 0; step < 500; step++) {
            // 检查投子认输
            if (this.shouldResign(board)) {
                resigned = board.currentPlayer;
                break;
            }

            const validMoves = board.getValidMovesFast();

            if (validMoves.length === 0) {
                board.pass();
                passes++;
                if (passes >= 2) break;
                continue;
            }

            // 收官阶段局势已定则停手
            if (this.isEndgameSettled(board)) {
                board.pass();
                board.pass();
                break;
            }

            // 没有有价值的棋可下时主动pass
            if (step > 120 && validMoves.length < 4) {
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

            if (step % 20 === 0) await new Promise(r => setTimeout(r, 0));
        }

        let winner;
        if (resigned > 0) {
            winner = 3 - resigned;
        } else {
            if (!board.isGameOver()) { board.pass(); board.pass(); }
            winner = board.getWinner();
        }

        const score = board.calculateScore();
        const points = board.calculatePoints();
        blackNet.learnFromResult(winner === 1);
        whiteNet.learnFromResult(winner === 2);

        return { winner, score, points, moves: board.moveCount, resigned: resigned > 0 };
    }

    // 展示对局：正常速度，更新两个棋盘
    async playShowcaseMatch(idx1, idx2) {
        const black = this.population[idx1];
        const white = this.population[idx2];
        const boardA = new GoBoard(this.boardSize);

        this.showcaseMatchA = { blackIdx: idx1, whiteIdx: idx2, board: boardA };

        // 棋盘B：Top1 vs Top2
        const topIndices = this.getTopIndices(2);
        const boardB = new GoBoard(this.boardSize);
        let topBWhiteIdx = topIndices[1];
        if (topBWhiteIdx === topIndices[0]) {
            topBWhiteIdx = this.selectRandomOpponentExcluding(topIndices[0]);
        }
        this.showcaseMatchB = {
            blackIdx: topIndices[0],
            whiteIdx: topBWhiteIdx,
            board: boardB
        };

        let moveCount = 0;
        let passesA = 0;
        let resigned = 0;

        for (let step = 0; step < 500 && this.isTraining && !this.isPaused; step++) {
            // 检查投子认输
            if (this.shouldResign(boardA)) {
                resigned = boardA.currentPlayer;
                break;
            }

            const validMovesA = boardA.getValidMovesFast();
            if (validMovesA.length === 0) {
                boardA.pass();
                passesA++;
                if (passesA >= 2) break;
            } else if (this.isEndgameSettled(boardA)) {
                boardA.pass();
                boardA.pass();
                break;
            } else if (step > 120 && validMovesA.length < 4) {
                boardA.pass();
                passesA++;
                if (passesA >= 2) break;
            } else {
                passesA = 0;
                const currentNetA = boardA.currentPlayer === 1 ? black.network : white.network;
                // 收官阶段降低temperature，避免无意义探索
                const temperature = boardA.moveCount > 150 ? 0.05 : Math.max(0.05, 0.5 - step / 400);
                const moveA = currentNetA.selectMove(boardA, validMovesA, temperature);
                if (moveA) {
                    boardA.makeMove(moveA[0], moveA[1]);
                } else {
                    boardA.pass();
                    passesA++;
                    if (passesA >= 2) break;
                }
            }

            this.simulateShowcaseBStep();
            moveCount++;

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

        let winner;
        if (resigned > 0) {
            winner = 3 - resigned;
        } else {
            if (!boardA.isGameOver()) { boardA.pass(); boardA.pass(); }
            winner = boardA.getWinner();
        }

        const score = boardA.calculateScore();
        const points = boardA.calculatePoints();
        black.network.learnFromResult(winner === 1);
        white.network.learnFromResult(winner === 2);

        if (this.onMatchEnd) {
            this.onMatchEnd({
                black: black.name,
                white: white.name,
                winner: winner,
                score: score,
                points: points,
                moves: moveCount,
                totalGames: this.totalGames,
                isShowcase: true,
                resigned: resigned > 0,
                resigner: resigned
            });
        }

        this.showcaseMatchB = null;
        return { winner, score, points, moves: moveCount, resigned: resigned > 0 };
    }

    simulateShowcaseBStep() {
        if (!this.showcaseMatchB) return;
        const tm = this.showcaseMatchB;
        const board = tm.board;
        if (board.isGameOver()) return;

        // 检查认输
        if (this.shouldResign(board)) {
            board.pass();
            board.pass();
            return;
        }

        const validMoves = board.getValidMovesFast();
        if (validMoves.length === 0 || (board.moveCount > 100 && validMoves.length < 3)) {
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
        const points = board.calculatePoints();
        return {
            board: board.getState(),
            blackName: this.population[tm.blackIdx].name,
            whiteName: this.population[tm.whiteIdx].name,
            blackPoints: points.black,
            whitePoints: points.white,
            pointDiff: points.diff,
            pointLead: points.leading,
            moveCount: board.moveCount,
            blackSpecies: this.population[tm.blackIdx].species,
            whiteSpecies: this.population[tm.whiteIdx].species
        };
    }

    getShowcaseBState() {
        if (!this.showcaseMatchB) return null;
        const tm = this.showcaseMatchB;
        const board = tm.board;
        const points = board.calculatePoints();
        return {
            board: board.getState(),
            blackName: this.population[tm.blackIdx].name,
            whiteName: this.population[tm.whiteIdx].name,
            blackPoints: points.black,
            whitePoints: points.white,
            pointDiff: points.diff,
            pointLead: points.leading,
            moveCount: board.moveCount,
            blackSpecies: this.population[tm.blackIdx].species,
            whiteSpecies: this.population[tm.whiteIdx].species
        };
    }

    updateStats(idx1, idx2, result) {
        const black = this.population[idx1];
        const white = this.population[idx2];
        const winner = result.winner;

        if (winner === 1) {
            black.wins++; white.losses++;
            this.speciesStats[black.species].totalWins++;
            this.speciesStats[white.species].totalLosses++;
        } else if (winner === 2) {
            white.wins++; black.losses++;
            this.speciesStats[white.species].totalWins++;
            this.speciesStats[black.species].totalLosses++;
        } else {
            black.draws++; white.draws++;
        }

        black.totalGames++; white.totalGames++;
        this.speciesStats[black.species].totalGames++;
        this.speciesStats[white.species].totalGames++;

        black.winRate = black.totalGames > 0 ? black.wins / black.totalGames : 0;
        white.winRate = white.totalGames > 0 ? white.wins / white.totalGames : 0;
        black.fitness = black.winRate * 100 + Math.min(10, black.totalGames / 10);
        white.fitness = white.winRate * 100 + Math.min(10, white.totalGames / 10);
    }

    // 遗传进化（每10局）
    async geneticEvolve() {
        this.log(`=== 第${this.generation}代遗传进化 ===`, 'info');

        // 更新种族胜率
        for (let s = 0; s < this.maxSpecies; s++) {
            const ss = this.speciesStats[s];
            if (ss.totalGames > 0) {
                const newWinRate = ss.totalWins / ss.totalGames;
                if (newWinRate < 0.35) ss.losingStreak++;
                else ss.losingStreak = Math.max(0, ss.losingStreak - 1);
                ss.winRate = newWinRate;
            }
        }

        const sorted = this.getSortedIndices();
        const eliteCount = 10;
        const newPopulation = [];

        // 精英保留
        for (let i = 0; i < eliteCount; i++) {
            const elite = this.population[sorted[i]];
            newPopulation.push({
                name: elite.name,
                network: this.cloneNetwork(elite.network),
                species: elite.species,
                wins: elite.wins,
                losses: elite.losses,
                draws: elite.draws,
                totalGames: elite.totalGames,
                winRate: elite.winRate,
                fitness: elite.fitness,
                generation: this.generation
            });
        }

        // 计算每个种族的目标人口数（基于胜率）
        const speciesTargets = this.calculateSpeciesTargets();

        // 按种族目标产生新个体
        while (newPopulation.length < this.populationSize) {
            const p1 = this.tournamentSelect(sorted, 5);
            const p2 = this.tournamentSelect(sorted, 5);
            const offspring = this.ga.createOffspring(p1.network, p2.network);

            // 决定新个体的种族
            let species = p1.fitness >= p2.fitness ? p1.species : p2.species;

            // 5% 变异：切换种族或创建新种族
            if (Math.random() < 0.05) {
                species = this.mutateSpecies(species);
            }

            newPopulation.push({
                name: `G${newPopulation.length + 1}`,
                network: offspring,
                species: species,
                wins: 0, losses: 0, draws: 0,
                totalGames: 0, winRate: 0, fitness: 0,
                generation: this.generation
            });
        }

        // 更新种族人口统计
        this.updateSpeciesPopulation(newPopulation);

        this.population = newPopulation;
        this.log(`遗传进化完成 | 精英:${eliteCount} | 活跃种族:${this.getActiveSpeciesCount()}`, 'success');
    }

    // 计算每个种族的目标人口数
    calculateSpeciesTargets() {
        const activeSpecies = [];
        for (let s = 0; s < this.maxSpecies; s++) {
            if (this.speciesStats[s].population > 0) {
                activeSpecies.push(s);
            }
        }
        if (activeSpecies.length === 0) return {};

        // 基于胜率分配人口：胜率高的种族获得更多人口
        const scores = activeSpecies.map(s => ({
            species: s,
            score: Math.max(0.1, this.speciesStats[s].winRate)
        }));
        const totalScore = scores.reduce((sum, s) => sum + s.score, 0);

        const targets = {};
        let allocated = 0;
        for (const s of scores) {
            targets[s.species] = Math.max(2, Math.floor(this.populationSize * s.score / totalScore));
            allocated += targets[s.species];
        }
        // 修正余数
        const diff = this.populationSize - allocated;
        if (diff !== 0 && scores.length > 0) {
            targets[scores[0].species] += diff;
        }
        return targets;
    }

    // 种族变异：切换到其他种族或创建新种族
    mutateSpecies(currentSpecies) {
        const activeSpecies = [];
        for (let s = 0; s < this.maxSpecies; s++) {
            if (this.speciesStats[s].population > 0 && s !== currentSpecies) {
                activeSpecies.push(s);
            }
        }

        // 30%概率创建新种族（如果未达上限）
        if (Math.random() < 0.3) {
            for (let s = 0; s < this.maxSpecies; s++) {
                if (this.speciesStats[s].population === 0) {
                    // 创建新种族的基础权重
                    const baseNet = new PolicyNetwork(this.boardSize);
                    this.ga.mutate(baseNet, 0.4);
                    this.speciesBaseWeights[s] = { ...baseNet.weights };
                    this.speciesStats[s].winRate = 0.5;
                    this.speciesStats[s].losingStreak = 0;
                    this.log(`新种族 S${s} 诞生！`, 'success');
                    return s;
                }
            }
        }

        // 70%概率切换到其他活跃种族
        if (activeSpecies.length > 0) {
            return activeSpecies[Math.floor(Math.random() * activeSpecies.length)];
        }
        return currentSpecies;
    }

    // 更新种族人口统计
    updateSpeciesPopulation(population) {
        for (let s = 0; s < this.maxSpecies; s++) {
            this.speciesStats[s].population = 0;
            this.speciesStats[s].totalWins = 0;
            this.speciesStats[s].totalLosses = 0;
            this.speciesStats[s].totalGames = 0;
        }
        for (const p of population) {
            this.speciesStats[p.species].population++;
        }
    }

    getActiveSpeciesCount() {
        let count = 0;
        for (let s = 0; s < this.maxSpecies; s++) {
            if (this.speciesStats[s].population > 0) count++;
        }
        return count;
    }

    // 保存种族人口快照
    saveSpeciesSnapshot() {
        const populations = [];
        for (let s = 0; s < this.maxSpecies; s++) {
            populations.push(this.speciesStats[s].population);
        }
        this.speciesHistory.push({
            generation: this.generation,
            totalGames: this.totalGames,
            populations: populations
        });
        if (this.speciesHistory.length > 100) {
            this.speciesHistory = this.speciesHistory.slice(-100);
        }
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
        if (this.winRateHistory.length > 100) {
            this.winRateHistory = this.winRateHistory.slice(-100);
        }
    }

    getAIResponse(board, difficulty = 'medium') {
        let iterations;
        switch (difficulty) {
            case 'easy': iterations = 15; break;
            case 'medium': iterations = 35; break;
            case 'hard': iterations = 80; break;
            default: iterations = 35;
        }
        return this.mcts.getBestMove(board, iterations);
    }

    getStats() {
        const sorted = this.getSortedIndices();
        const top10 = sorted.slice(0, 10).map(i => ({
            name: this.population[i].name,
            winRate: this.population[i].winRate,
            totalGames: this.population[i].totalGames,
            fitness: this.population[i].fitness,
            idx: i,
            species: this.population[i].species
        }));
        const allWinRates = this.population.map(p => p.winRate);
        const avgWinRate = allWinRates.reduce((a, b) => a + b, 0) / allWinRates.length;

        // 种族摘要
        const speciesSummary = [];
        for (let s = 0; s < this.maxSpecies; s++) {
            if (this.speciesStats[s].population > 0) {
                speciesSummary.push({
                    species: s,
                    population: this.speciesStats[s].population,
                    winRate: this.speciesStats[s].winRate
                });
            }
        }

        return {
            generation: this.generation,
            totalGames: this.totalGames,
            top10: top10,
            avgWinRate: avgWinRate,
            winRateHistory: this.winRateHistory,
            bestName: this.population[sorted[0]].name,
            bestWinRate: this.population[sorted[0]].winRate,
            watchedAiIdx: this.watchedAiIdx,
            speciesSummary: speciesSummary,
            speciesHistory: this.speciesHistory
        };
    }

    getSaveData() {
        return {
            version: '6.0',
            boardSize: this.boardSize,
            populationSize: this.populationSize,
            generation: this.generation,
            totalGames: this.totalGames,
            population: this.population.map(p => ({
                name: p.name,
                network: p.network.save(),
                species: p.species,
                wins: p.wins,
                losses: p.losses,
                draws: p.draws,
                totalGames: p.totalGames,
                winRate: p.winRate,
                fitness: p.fitness,
                generation: p.generation
            })),
            speciesStats: this.speciesStats,
            speciesBaseWeights: this.speciesBaseWeights,
            winRateHistory: this.winRateHistory,
            speciesHistory: this.speciesHistory,
            timestamp: Date.now()
        };
    }

    saveToLocalStorage() {
        try {
            const data = this.getSaveData();
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
            localStorage.setItem('eve-go-400-model', JSON.stringify(compactData));
        } catch (e) {
            console.error('保存失败:', e);
        }
    }

    async loadLatestModel() {
        const saved = localStorage.getItem('eve-go-400-model');
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
        if (data.speciesBaseWeights) {
            this.speciesBaseWeights = data.speciesBaseWeights;
        }
        if (data.speciesStats) {
            this.speciesStats = data.speciesStats;
        }

        if (data.population && data.population.length > 0) {
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
                            species: p.species || 0,
                            wins: p.wins || 0,
                            losses: p.losses || 0,
                            draws: p.draws || 0,
                            totalGames: p.totalGames || 0,
                            winRate: p.winRate || 0,
                            fitness: p.fitness || 0,
                            generation: p.generation || 0
                        });
                    } else {
                        const species = i % this.speciesCount;
                        this.population.push({
                            name: `G${i + 1}`,
                            network: new PolicyNetwork(this.boardSize),
                            species: species,
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
                        species: p.species || 0,
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
        if (data.speciesHistory) this.speciesHistory = data.speciesHistory;

        const sorted = this.getSortedIndices();
        this.bestIdx = sorted[0];
        this.mcts.setPolicyNetwork(this.population[this.bestIdx].network);
    }

    log(msg, type) {
        if (this.onLog) this.onLog(msg, type);
    }
}
