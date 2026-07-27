// 遗传算法模块 - 选择、交叉、变异
class GeneticAlgorithm {
    constructor(boardSize = 19, mutationRate = 0.15) {
        this.boardSize = boardSize;
        this.mutationRate = mutationRate;
        this.evolutionGeneration = 0;
    }

    setMutationRate(rate) {
        this.mutationRate = Math.max(0.01, Math.min(0.8, rate / 100));
    }

    // 创建一个新的随机模型（新生代G3）
    createOffspring(parent1, parent2 = null) {
        const offspring = new PolicyNetwork(this.boardSize);

        if (!parent2) {
            offspring.load(parent1.save());
            this.mutate(offspring, this.mutationRate);
        } else {
            this.crossover(parent1, parent2, offspring);
            this.mutate(offspring, this.mutationRate * 0.5);
        }

        return offspring;
    }

    // 变异操作 - 随机修改部分权重
    mutate(network, rate = 0.15) {
        const weights = network.weights;
        const keys = Object.keys(weights);

        for (const key of keys) {
            if (Math.random() < rate) {
                const mutationAmount = (Math.random() - 0.5) * Math.abs(weights[key]) * 0.8 + 0.1;
                const direction = Math.random() < 0.5 ? 1 : -1;
                weights[key] += direction * mutationAmount;
                weights[key] = Math.max(-5, Math.min(5, weights[key]));
            }
        }

        // 有一定概率对单个权重进行大突变
        if (Math.random() < rate * 0.3) {
            const randomKey = keys[Math.floor(Math.random() * keys.length)];
            const bigMutation = (Math.random() - 0.5) * 2;
            weights[randomKey] += bigMutation;
            weights[randomKey] = Math.max(-5, Math.min(5, weights[randomKey]));
        }
    }

    // 交叉操作 - 融合两个父代的权重
    crossover(parent1, parent2, offspring) {
        const w1 = parent1.weights;
        const w2 = parent2.weights;
        const keys = Object.keys(w1);

        const crossoverPoint = Math.floor(Math.random() * keys.length);

        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (i < crossoverPoint) {
                offspring.weights[key] = w1[key];
            } else {
                offspring.weights[key] = w2[key];
            }
        }

        // 对部分权重进行均匀混合
        const blendCount = Math.floor(keys.length * 0.3);
        for (let i = 0; i < blendCount; i++) {
            const randomKey = keys[Math.floor(Math.random() * keys.length)];
            const blendRatio = Math.random();
            offspring.weights[randomKey] = w1[randomKey] * blendRatio + w2[randomKey] * (1 - blendRatio);
        }
    }

    // 创建变异体（用于G2的变异版本）
    createMutant(parent, intensity = 0.2) {
        const mutant = new PolicyNetwork(this.boardSize);
        mutant.load(parent.save());
        this.mutate(mutant, intensity);
        return mutant;
    }

    // 锦标赛选择 - 从群体中选出优胜者
    tournamentSelection(population, scores, tournamentSize = 3) {
        const indices = [];
        while (indices.length < tournamentSize) {
            const idx = Math.floor(Math.random() * population.length);
            if (!indices.includes(idx)) indices.push(idx);
        }

        let bestIdx = indices[0];
        let bestScore = scores[bestIdx];
        for (const idx of indices) {
            if (scores[idx] > bestScore) {
                bestScore = scores[idx];
                bestIdx = idx;
            }
        }

        return population[bestIdx];
    }

    // 每10代进行一次大规模遗传进化
    evolveGeneration(population, scores) {
        this.evolutionGeneration++;

        const sortedIndices = scores
            .map((s, i) => ({ score: s, index: i }))
            .sort((a, b) => b.score - a.score)
            .map(x => x.index);

        // 精英保留：前2名直接进入下一代
        const newPopulation = [
            population[sortedIndices[0]],
            population[sortedIndices[1]]
        ];

        // 锦标赛选择 + 交叉变异产生新个体
        while (newPopulation.length < population.length) {
            const parent1 = this.tournamentSelection(population, scores);
            const parent2 = this.tournamentSelection(population, scores);
            const offspring = this.createOffspring(parent1, parent2);
            newPopulation.push(offspring);
        }

        return {
            population: newPopulation,
            bestIndex: sortedIndices[0],
            bestScore: scores[sortedIndices[0]]
        };
    }

    // 计算适应度分数（基于多场对战结果）
    calculateFitness(winCount, totalGames, avgMargin = 0) {
        const winRate = totalGames > 0 ? winCount / totalGames : 0;
        const marginBonus = Math.max(0, Math.min(0.2, avgMargin / 100));
        return winRate * 0.8 + marginBonus + 0.001 * Math.random();
    }
}

// 模型个体 - 包装策略网络 + 适应度
class ModelIndividual {
    constructor(network, name) {
        this.network = network;
        this.name = name;
        this.wins = 0;
        this.losses = 0;
        this.draws = 0;
        this.fitness = 0;
        this.games = [];
    }

    recordGame(winner, margin = 0) {
        this.games.push({ winner, margin });
        if (winner === 1) this.wins++;
        else if (winner === 2) this.losses++;
        else this.draws++;
        this.updateFitness();
    }

    updateFitness() {
        const total = this.wins + this.losses + this.draws;
        if (total === 0) {
            this.fitness = 0;
            return;
        }
        const winRate = this.wins / total;
        const avgMargin = this.games.length > 0
            ? this.games.reduce((sum, g) => sum + (g.margin || 0), 0) / this.games.length
            : 0;
        this.fitness = winRate * 100 + Math.max(-20, Math.min(20, avgMargin / 2));
    }

    reset() {
        this.wins = 0;
        this.losses = 0;
        this.draws = 0;
        this.fitness = 0;
        this.games = [];
    }
}