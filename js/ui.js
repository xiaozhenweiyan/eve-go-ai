class GoUI {
    constructor() {
        this.boardSize = 19;
        this.canvasA = document.getElementById('go-board-a');
        this.canvasB = document.getElementById('go-board-b');
        this.ctxA = this.canvasA.getContext('2d');
        this.ctxB = this.canvasB.getContext('2d');
        this.chartCanvas = document.getElementById('chart-canvas');
        this.chartCtx = this.chartCanvas.getContext('2d');

        this.trainer = new EveTrainer(this.boardSize);
        this.mode = 'training';
        this.playerColor = 1;
        this.gameBoard = new GoBoard(this.boardSize);

        // 棋盘绘制参数
        this.cellSize = 20;
        this.offset = 20;
        this.stoneRadius = 9;

        // 人机对战用的单棋盘（隐藏的canvas引用，复用draw逻辑）
        this.singleBoardCanvas = this.canvasA;
        this.singleBoardCtx = this.ctxA;

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.drawEmptyBoard(this.ctxA);
        this.drawEmptyBoard(this.ctxB);
        this.loadLatestModel();
        this.drawChart();
        this.log('Eve 进化系统已就绪 (19x19)', 'info');
    }

    setupEventListeners() {
        // Canvas点击（人机对战）
        this.canvasA.addEventListener('click', (e) => this.handleBoardClick(e));

        // 模式切换
        document.getElementById('btn-training').addEventListener('click', () => this.switchMode('training'));
        document.getElementById('btn-play').addEventListener('click', () => this.switchMode('play'));

        // 训练控制
        document.getElementById('btn-start-training').addEventListener('click', () => this.startTraining());
        document.getElementById('btn-stop-training').addEventListener('click', () => this.stopTraining());
        document.getElementById('btn-load-model').addEventListener('click', () => this.loadModel());
        document.getElementById('btn-save-model').addEventListener('click', () => this.saveModel());

        // 对战控制
        document.getElementById('btn-reset-game').addEventListener('click', () => this.resetGame());
        document.getElementById('btn-pass').addEventListener('click', () => this.pass());
        document.getElementById('btn-ai-move').addEventListener('click', () => this.aiMove());

        // 速度滑块
        const speedSlider = document.getElementById('speed-slider');
        speedSlider.addEventListener('input', (e) => {
            const speed = parseInt(e.target.value);
            document.getElementById('speed-value').textContent = speed;
            this.trainer.setSpeed(speed);
        });

        // 变异率设置
        const mutationInput = document.getElementById('mutation-rate');
        mutationInput.addEventListener('change', (e) => {
            const rate = parseInt(e.target.value);
            this.trainer.setMutationRate(rate);
            this.log(`变异率设置为 ${rate}%`, 'info');
        });

        // 上传
        document.getElementById('model-upload').addEventListener('change', (e) => this.handleFileUpload(e));
        document.getElementById('btn-upload-model').addEventListener('click', () => this.uploadModel());
    }

    switchMode(mode) {
        if (this.trainer.isTraining) {
            this.log('请先停止进化再切换模式', 'warning');
            return;
        }
        this.mode = mode;
        document.getElementById('btn-training').classList.toggle('active', mode === 'training');
        document.getElementById('btn-play').classList.toggle('active', mode === 'play');
        document.getElementById('training-controls').classList.toggle('hidden', mode !== 'training');
        document.getElementById('play-controls').classList.toggle('hidden', mode !== 'play');

        if (mode === 'play') {
            // 切换到单棋盘模式（使用canvasA）
            document.querySelector('.dual-boards').style.flexDirection = 'column';
            this.canvasB.style.display = 'none';
            document.querySelector('#board-b-title').parentElement.style.display = 'none';
            this.canvasA.width = 600;
            this.canvasA.height = 600;
            this.cellSize = 30;
            this.offset = 30;
            this.stoneRadius = 13;
            this.resetGame();
        } else {
            // 双棋盘模式
            document.querySelector('.dual-boards').style.flexDirection = 'row';
            this.canvasB.style.display = 'block';
            document.querySelector('#board-b-title').parentElement.style.display = 'flex';
            this.canvasA.width = 420;
            this.canvasA.height = 420;
            this.canvasB.width = 420;
            this.canvasB.height = 420;
            this.cellSize = 20;
            this.offset = 20;
            this.stoneRadius = 9;
            this.drawEmptyBoard(this.ctxA);
            this.drawEmptyBoard(this.ctxB);
        }
    }

    // ===== 棋盘绘制 =====
    drawEmptyBoard(ctx) {
        const size = this.boardSize;
        const canvas = ctx.canvas;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const bgGrad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        bgGrad.addColorStop(0, '#dcb35c');
        bgGrad.addColorStop(1, '#c9a040');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = '#5c4033';
        ctx.lineWidth = 1;
        for (let i = 0; i < size; i++) {
            const pos = this.offset + i * this.cellSize;
            ctx.beginPath();
            ctx.moveTo(this.offset, pos);
            ctx.lineTo(this.offset + (size - 1) * this.cellSize, pos);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(pos, this.offset);
            ctx.lineTo(pos, this.offset + (size - 1) * this.cellSize);
            ctx.stroke();
        }

        // 星位
        const stars = [[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]];
        for (const [r, c] of stars) {
            const x = this.offset + c * this.cellSize;
            const y = this.offset + r * this.cellSize;
            ctx.beginPath();
            ctx.arc(x, y, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = '#5c4033';
            ctx.fill();
        }
    }

    drawBoard(ctx, board, lastMove = null) {
        this.drawEmptyBoard(ctx);
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const stone = board.board[board.idx(row, col)];
                if (stone !== 0) {
                    this.drawStone(ctx, row, col, stone);
                }
            }
        }
        if (lastMove) {
            const x = this.offset + lastMove[1] * this.cellSize;
            const y = this.offset + lastMove[0] * this.cellSize;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#ff0000';
            ctx.fill();
        }
    }

    drawStone(ctx, row, col, color) {
        const x = this.offset + col * this.cellSize;
        const y = this.offset + row * this.cellSize;
        ctx.beginPath();
        ctx.arc(x, y, this.stoneRadius, 0, Math.PI * 2);
        const gradient = ctx.createRadialGradient(x - 3, y - 3, 2, x, y, this.stoneRadius);
        if (color === 1) {
            gradient.addColorStop(0, '#666');
            gradient.addColorStop(1, '#111');
        } else {
            gradient.addColorStop(0, '#fff');
            gradient.addColorStop(1, '#ccc');
        }
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = color === 1 ? '#000' : '#999';
        ctx.lineWidth = 0.5;
        ctx.stroke();
    }

    // ===== 训练相关 =====
    async startTraining() {
        const rate = parseInt(document.getElementById('mutation-rate').value);
        this.trainer.setMutationRate(rate);

        document.getElementById('btn-start-training').disabled = true;
        document.getElementById('btn-stop-training').disabled = false;
        document.getElementById('training-status').textContent = '进化中';
        document.getElementById('phase-status').textContent = '初始化...';
        this.log('开始进化训练...', 'info');

        // 设置回调
        this.trainer.onBoardUpdate = (data) => this.handleBoardUpdate(data);
        this.trainer.onGameEnd = (data) => this.handleGameEnd(data);
        this.trainer.onGenEnd = (data) => this.handleGenEnd(data);
        this.trainer.onEvoEnd = (data) => this.handleEvoEnd(data);
        this.trainer.onLog = (msg, type) => this.log(msg, type);

        await this.trainer.startTraining();

        document.getElementById('btn-start-training').disabled = false;
        document.getElementById('btn-stop-training').disabled = true;
        document.getElementById('training-status').textContent = '已停止';
        document.getElementById('phase-status').textContent = '已停止';
        this.log('进化已停止', 'warning');
    }

    stopTraining() {
        this.trainer.stopTraining();
    }

    handleBoardUpdate(data) {
        if (data.boardA) {
            const board = new GoBoard(this.boardSize);
            board.setState(data.boardA);
            this.drawBoard(this.ctxA, board);
            const score = board.calculateScore();
            document.getElementById('black-score-a').textContent = score.black.toFixed(1);
            document.getElementById('white-score-a').textContent = score.white.toFixed(1);
            if (data.matchA) {
                document.getElementById('match-type-a').textContent = data.matchA;
            }
        }
        if (data.boardB) {
            const board = new GoBoard(this.boardSize);
            board.setState(data.boardB);
            this.drawBoard(this.ctxB, board);
            const score = board.calculateScore();
            document.getElementById('black-score-b').textContent = score.black.toFixed(1);
            document.getElementById('white-score-b').textContent = score.white.toFixed(1);
            if (data.matchB) {
                document.getElementById('match-type-b').textContent = data.matchB;
            }
        }
        if (data.moveCount !== undefined) {
            document.getElementById('move-count').textContent = data.moveCount;
        }
        if (data.currentMatch !== undefined) {
            document.getElementById('phase-status').textContent = `对局 ${data.currentMatch}/2`;
            // 高亮当前棋盘
            document.querySelectorAll('.board-panel').forEach((el, i) => {
                el.classList.toggle('active', i === data.currentMatch - 1);
            });
        }
    }

    handleGameEnd(data) {
        document.getElementById('games-played').textContent = data.generation;
        this.updateModelRanking();
    }

    handleGenEnd(data) {
        document.getElementById('generation').textContent = data.generation;
        document.getElementById('evo-generation').textContent = `${this.trainer.evoCycle} / 10`;
        document.getElementById('g3-win-rate').textContent = `${Math.round(data.g3WinRate * 100)}%`;
        document.getElementById('best-model').textContent = data.bestModel;
        document.getElementById('games-played').textContent = data.totalGames;
        document.getElementById('phase-status').textContent = '新代评估';
        this.drawChart();
        this.updateModelRanking();
    }

    handleEvoEnd(data) {
        this.log(`遗传进化完成！新适应度: ${data.bestFitness.toFixed(2)}`, 'success');
        document.getElementById('phase-status').textContent = '遗传进化完成';
        this.updateModelRanking();
    }

    updateModelRanking() {
        const ranking = this.trainer.getModelRanking();
        const container = document.getElementById('model-ranking');
        container.innerHTML = '';
        ranking.forEach((item, idx) => {
            const div = document.createElement('div');
            div.className = 'rank-item';
            div.innerHTML = `
                <span class="rank">${idx + 1}</span>
                <span class="name">${item.name}</span>
                <span class="score">${item.score}</span>
            `;
            container.appendChild(div);
        });
    }

    // ===== 人机对战 =====
    handleBoardClick(e) {
        if (this.mode !== 'play') return;
        if (this.gameBoard.currentPlayer !== this.playerColor) return;

        const canvas = this.canvasA;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        const col = Math.round((x - this.offset) / this.cellSize);
        const row = Math.round((y - this.offset) / this.cellSize);

        if (row >= 0 && row < this.boardSize && col >= 0 && col < this.boardSize) {
            if (this.gameBoard.makeMove(row, col)) {
                this.drawBoard(this.ctxA, this.gameBoard, [row, col]);
                this.updateGameInfo();
                if (!this.gameBoard.isGameOver()) {
                    setTimeout(() => this.aiMove(), 300);
                } else {
                    this.showGameResult();
                }
            }
        }
    }

    resetGame() {
        this.gameBoard.initBoard();
        this.playerColor = 1;
        this.drawBoard(this.ctxA, this.gameBoard);
        this.updateGameInfo();
        this.log('新对局开始 - 你执黑', 'info');
    }

    pass() {
        if (this.mode !== 'play') return;
        this.gameBoard.pass();
        this.drawBoard(this.ctxA, this.gameBoard);
        this.updateGameInfo();
        if (!this.gameBoard.isGameOver()) {
            setTimeout(() => this.aiMove(), 300);
        } else {
            this.showGameResult();
        }
    }

    aiMove() {
        if (this.mode !== 'play' || this.gameBoard.isGameOver()) return;
        this.log('AI思考中...', 'info');
        const difficulty = document.getElementById('difficulty-select').value;
        setTimeout(() => {
            const move = this.trainer.getAIResponse(this.gameBoard, difficulty);
            if (move) {
                this.gameBoard.makeMove(move[0], move[1]);
                this.drawBoard(this.ctxA, this.gameBoard, move);
                this.updateGameInfo();
                this.log(`AI落子: (${move[0]}, ${move[1]})`, 'info');
            } else {
                this.gameBoard.pass();
                this.drawBoard(this.ctxA, this.gameBoard);
                this.updateGameInfo();
                this.log('AI选择跳过', 'info');
            }
            if (this.gameBoard.isGameOver()) {
                this.showGameResult();
            }
        }, 100);
    }

    updateGameInfo() {
        const player = this.gameBoard.currentPlayer === 1 ? '黑方' : '白方';
        document.getElementById('current-player').textContent = player;
        const score = this.gameBoard.calculateScore();
        document.getElementById('black-score').textContent = score.black.toFixed(1);
        document.getElementById('white-score').textContent = score.white.toFixed(1);
    }

    showGameResult() {
        const winner = this.gameBoard.getWinner();
        const score = this.gameBoard.calculateScore();
        let message = '';
        if (winner === 0) message = '平局！';
        else message = winner === 1
            ? `黑方获胜！(${score.black.toFixed(1)} vs ${score.white.toFixed(1)})`
            : `白方获胜！(${score.white.toFixed(1)} vs ${score.black.toFixed(1)})`;
        this.log(message, 'success');
        setTimeout(() => alert(message), 200);
    }

    // ===== 图表 =====
    drawChart() {
        const ctx = this.chartCtx;
        const W = this.chartCanvas.width;
        const H = this.chartCanvas.height;
        ctx.clearRect(0, 0, W, H);

        const history = this.trainer.getTrainingStats().winHistory;
        if (history.length === 0) {
            ctx.fillStyle = '#666';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('暂无进化数据 - 点击"开始进化"开始训练', W / 2, H / 2);
            return;
        }

        const padding = 50;
        const width = W - padding * 2;
        const height = H - padding * 2;

        // 网格
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = padding + (height / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padding, y);
            ctx.lineTo(W - padding, y);
            ctx.stroke();
        }

        // 坐标轴标签
        ctx.fillStyle = '#aaa';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('100%', padding - 5, padding + 4);
        ctx.fillText('50%', padding - 5, padding + height / 2 + 4);
        ctx.fillText('0%', padding - 5, padding + height + 4);

        // G3胜率曲线
        ctx.strokeStyle = '#00d2ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const stepX = history.length > 1 ? width / (history.length - 1) : 0;
        for (let i = 0; i < history.length; i++) {
            const x = padding + i * stepX;
            const y = padding + height * (1 - history[i].g3WinRate);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 数据点
        ctx.fillStyle = '#00d2ff';
        for (let i = 0; i < history.length; i++) {
            const x = padding + i * stepX;
            const y = padding + height * (1 - history[i].g3WinRate);
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // 50%参考线
        ctx.strokeStyle = 'rgba(255, 170, 0, 0.5)';
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(padding, padding + height / 2);
        ctx.lineTo(W - padding, padding + height / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // X轴标签
        ctx.textAlign = 'center';
        ctx.fillStyle = '#aaa';
        const labelStep = Math.max(1, Math.floor(history.length / 10));
        for (let i = 0; i < history.length; i += labelStep) {
            const x = padding + i * stepX;
            ctx.fillText(`G${history[i].generation}`, x, H - 15);
        }

        // 图例
        ctx.fillStyle = '#00d2ff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('● G3新生代胜率', padding, 25);
        ctx.fillStyle = '#ffaa00';
        ctx.fillText('--- 50%基准线 (G3≥50%则进化成功)', padding + 150, 25);
    }

    // ===== 日志 =====
    log(message, type = 'info') {
        const logContent = document.getElementById('log-content');
        const p = document.createElement('p');
        p.className = type;
        const time = new Date().toLocaleTimeString();
        p.textContent = `[${time}] ${message}`;
        logContent.appendChild(p);
        logContent.scrollTop = logContent.scrollHeight;
        while (logContent.children.length > 150) {
            logContent.removeChild(logContent.firstChild);
        }
    }

    // ===== 模型加载/保存 =====
    async loadLatestModel() {
        const loaded = await this.trainer.loadLatestModel();
        if (loaded) {
            const stats = this.trainer.getTrainingStats();
            document.getElementById('generation').textContent = stats.generation;
            document.getElementById('evo-generation').textContent = `${stats.evoCycle} / 10`;
            document.getElementById('games-played').textContent = stats.totalGames;
            document.getElementById('g3-win-rate').textContent = `${Math.round(stats.avgG3WinRate * 100)}%`;
            this.drawChart();
            this.updateModelRanking();
            this.log(`已加载最新模型 (第${stats.generation}代)`, 'success');
        }
    }

    loadModel() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const data = JSON.parse(event.target.result);
                        this.trainer.loadTrainingData(data);
                        const stats = this.trainer.getTrainingStats();
                        document.getElementById('generation').textContent = stats.generation;
                        document.getElementById('evo-generation').textContent = `${stats.evoCycle} / 10`;
                        document.getElementById('games-played').textContent = stats.totalGames;
                        this.drawChart();
                        this.updateModelRanking();
                        this.log('模型加载成功', 'success');
                    } catch (err) {
                        this.log('模型加载失败: ' + err.message, 'error');
                    }
                };
                reader.readAsText(file);
            }
        };
        input.click();
    }

    saveModel() {
        const data = this.trainer.getSaveData();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `eve-go-19-gen-${this.trainer.generation}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.log(`模型已保存 (第${this.trainer.generation}代)`, 'success');
    }

    handleFileUpload(e) {
        this.uploadFile = e.target.files[0];
    }

    uploadModel() {
        if (!this.uploadFile) {
            document.getElementById('upload-status').textContent = '请先选择文件';
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                this.trainer.loadTrainingData(data);
                const stats = this.trainer.getTrainingStats();
                document.getElementById('generation').textContent = stats.generation;
                document.getElementById('evo-generation').textContent = `${stats.evoCycle} / 10`;
                document.getElementById('games-played').textContent = stats.totalGames;
                this.drawChart();
                this.updateModelRanking();
                document.getElementById('upload-status').textContent = '模型上传成功！';
                this.log('模型上传成功', 'success');
            } catch (err) {
                document.getElementById('upload-status').textContent = '模型上传失败';
                this.log('模型上传失败: ' + err.message, 'error');
            }
        };
        reader.readAsText(this.uploadFile);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new GoUI();
});