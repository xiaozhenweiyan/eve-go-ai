class GoUI {
    constructor() {
        this.boardSize = 19;
        this.canvasA = document.getElementById('go-board-a');
        this.canvasB = document.getElementById('go-board-b');
        this.ctxA = this.canvasA.getContext('2d');
        this.ctxB = this.canvasB.getContext('2d');
        this.chartCanvas = document.getElementById('chart-canvas');
        this.chartCtx = this.chartCanvas.getContext('2d');

        this.trainer = new EveTrainer(this.boardSize, 200);
        this.mode = 'training';
        this.playerColor = 1;
        this.gameBoard = new GoBoard(this.boardSize);

        // 棋盘绘制参数
        this.cellSize = 20;
        this.offset = 20;
        this.stoneRadius = 9;

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.drawEmptyBoard(this.ctxA);
        this.drawEmptyBoard(this.ctxB);
        this.populateAiSelect();
        this.loadLatestModel();
        this.drawChart();
        this.log('Eve 200 AI 进化系统已就绪', 'info');
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
        document.getElementById('btn-pause-training').addEventListener('click', () => this.pauseTraining());
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

        // AI选择下拉框
        document.getElementById('watch-ai').addEventListener('change', (e) => {
            const val = e.target.value;
            if (val !== '') {
                const idx = parseInt(val);
                this.trainer.setWatchedAi(idx);
                document.getElementById('watch-status').textContent =
                    `观看: ${this.trainer.population[idx].name}`;
                this.log(`已选定观看 AI: ${this.trainer.population[idx].name}`, 'info');
            } else {
                this.trainer.setWatchedAi(-1);
                document.getElementById('watch-status').textContent = '自动模式 (Top胜率)';
                this.log('已切换到自动观看模式', 'info');
            }
        });

        // 上传/加载
        document.getElementById('model-upload').addEventListener('change', (e) => this.handleFileUpload(e));
        document.getElementById('btn-upload-model').addEventListener('click', () => this.uploadModel());
        document.getElementById('btn-load-model').addEventListener('click', () => this.loadModel());
    }

    populateAiSelect() {
        const select = document.getElementById('watch-ai');
        select.innerHTML = '<option value="">-- 自动 (Top胜率) --</option>';
        for (let i = 0; i < this.trainer.populationSize; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = this.trainer.population[i].name;
            select.appendChild(opt);
        }
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
        document.getElementById('leaderboard-panel').classList.toggle('hidden', mode !== 'training');

        if (mode === 'play') {
            this.canvasA.width = 600;
            this.canvasA.height = 600;
            this.canvasB.parentElement.style.display = 'none';
            document.getElementById('watch-control').style.display = 'none';
            this.cellSize = 30;
            this.offset = 30;
            this.stoneRadius = 13;
            this.resetGame();
        } else {
            this.canvasA.width = 420;
            this.canvasA.height = 420;
            this.canvasB.width = 420;
            this.canvasB.height = 420;
            this.canvasB.parentElement.style.display = 'flex';
            document.getElementById('watch-control').style.display = 'flex';
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
                if (stone !== 0) this.drawStone(ctx, row, col, stone);
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

    // ===== 训练控制 =====
    async startTraining() {
        document.getElementById('btn-start-training').disabled = true;
        document.getElementById('btn-stop-training').disabled = false;
        document.getElementById('btn-pause-training').disabled = false;
        document.getElementById('training-status').textContent = '进化中';
        this.log('200 AI 进化训练开始！', 'info');

        this.trainer.onBoardUpdate = (data) => this.handleBoardUpdate(data);
        this.trainer.onMatchEnd = (data) => this.handleMatchEnd(data);
        this.trainer.onStatsUpdate = (stats) => this.handleStatsUpdate(stats);
        this.trainer.onLog = (msg, type) => this.log(msg, type);

        await this.trainer.startTraining();

        document.getElementById('btn-start-training').disabled = false;
        document.getElementById('btn-stop-training').disabled = true;
        document.getElementById('btn-pause-training').disabled = true;
        document.getElementById('btn-pause-training').textContent = '暂停';
        document.getElementById('training-status').textContent = '已停止';
        this.log('进化已停止', 'warning');
    }

    stopTraining() {
        this.trainer.stopTraining();
    }

    pauseTraining() {
        const paused = this.trainer.pauseTraining();
        document.getElementById('btn-pause-training').textContent = paused ? '继续' : '暂停';
        document.getElementById('training-status').textContent = paused ? '已暂停' : '进化中';
        if (paused) {
            this.log('训练已暂停，可以选定AI观看', 'info');
        }
    }

    handleBoardUpdate(data) {
        // 棋盘A：精选对局（ watched AI 或 Top AI）
        if (data.showcaseA && data.showcaseA.board) {
            const board = new GoBoard(this.boardSize);
            board.setState(data.showcaseA.board);
            this.drawBoard(this.ctxA, board);
            document.getElementById('black-name-a').textContent = data.showcaseA.blackName;
            document.getElementById('white-name-a').textContent = data.showcaseA.whiteName;
            document.getElementById('black-score-a').textContent = data.showcaseA.blackScore.toFixed(1);
            document.getElementById('white-score-a').textContent = data.showcaseA.whiteScore.toFixed(1);
            document.getElementById('match-info-a').textContent =
                `${data.showcaseA.blackName} vs ${data.showcaseA.whiteName} 第${data.showcaseA.moveCount}手`;
        }

        // 棋盘B：Top1 vs Top2 模拟对局
        if (data.showcaseB && data.showcaseB.board) {
            const board = new GoBoard(this.boardSize);
            board.setState(data.showcaseB.board);
            this.drawBoard(this.ctxB, board);
            document.getElementById('black-name-b').textContent = data.showcaseB.blackName;
            document.getElementById('white-name-b').textContent = data.showcaseB.whiteName;
            document.getElementById('black-score-b').textContent = data.showcaseB.blackScore.toFixed(1);
            document.getElementById('white-score-b').textContent = data.showcaseB.whiteScore.toFixed(1);
            document.getElementById('match-info-b').textContent =
                `${data.showcaseB.blackName} vs ${data.showcaseB.whiteName} 第${data.showcaseB.moveCount}手`;
        }

        document.getElementById('total-games').textContent = data.totalGames;
    }

    handleMatchEnd(data) {
        const prefix = data.isShowcase ? '[展示]' : '[后台]';
        const w = data.winner === 1 ? data.black : data.winner === 2 ? data.white : '平局';
        this.log(`${prefix} #${data.totalGames} ${data.black} vs ${data.white} -> ${w}`, 'info');
    }

    handleStatsUpdate(stats) {
        document.getElementById('generation').textContent = stats.generation;
        document.getElementById('total-games').textContent = stats.totalGames;
        this.updateLeaderboard(stats.top10);
        this.drawChart();
        this.populateAiSelect();
    }

    updateLeaderboard(top10) {
        const container = document.getElementById('leaderboard-body');
        container.innerHTML = '';
        top10.forEach((item, idx) => {
            const div = document.createElement('div');
            div.className = 'leaderboard-row';
            if (this.trainer.watchedAiIdx === item.idx) div.classList.add('selected');
            div.innerHTML = `
                <span class="rank">${idx + 1}</span>
                <span class="name">${item.name}</span>
                <span class="winrate">${(item.winRate * 100).toFixed(1)}%</span>
                <span class="games">${item.totalGames}</span>
            `;
            div.addEventListener('click', () => {
                const select = document.getElementById('watch-ai');
                select.value = item.idx;
                this.trainer.setWatchedAi(item.idx);
                document.getElementById('watch-status').textContent = `观看: ${item.name}`;
                this.updateLeaderboard(top10);
                this.log(`已选择观看 AI: ${item.name}`, 'info');
            });
            container.appendChild(div);
        });
    }

    // ===== 图表：200 AI胜率分布 =====
    drawChart() {
        const ctx = this.chartCtx;
        const W = this.chartCanvas.width;
        const H = this.chartCanvas.height;
        ctx.clearRect(0, 0, W, H);

        const history = this.trainer.winRateHistory;
        if (history.length === 0) {
            ctx.fillStyle = '#666';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('暂无数据 - 开始进化后显示200 AI胜率分布', W / 2, H / 2);
            return;
        }

        const pad = 50;
        const w = W - pad * 2;
        const h = H - pad * 2;
        const stepX = history.length > 1 ? w / (history.length - 1) : 0;

        // 网格
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const y = pad + (h / 5) * i;
            ctx.beginPath();
            ctx.moveTo(pad, y);
            ctx.lineTo(W - pad, y);
            ctx.stroke();
        }

        // Y轴标签
        ctx.fillStyle = '#888';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        for (let i = 0; i <= 5; i++) {
            const y = pad + (h / 5) * i;
            ctx.fillText(`${100 - i * 20}%`, pad - 6, y + 3);
        }

        // 1. 画所有200个AI的胜率（半透明细线）
        ctx.globalAlpha = 0.08;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 0.5;
        for (let ai = 0; ai < this.trainer.populationSize; ai++) {
            ctx.beginPath();
            for (let g = 0; g < history.length; g++) {
                const x = pad + g * stepX;
                const y = pad + h * (1 - history[g].all[ai]);
                if (g === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // 2. 画Top 10的胜率（亮色线）
        const colors = ['#00d2ff', '#00ff88', '#ff6b6b', '#ffd93d', '#a855f7',
                        '#f472b6', '#38bdf8', '#fb923c', '#a3e635', '#22d3ee'];
        for (let rank = 0; rank < 10; rank++) {
            ctx.strokeStyle = colors[rank] || '#fff';
            ctx.lineWidth = rank < 3 ? 2 : 1.2;
            ctx.beginPath();
            for (let g = 0; g < history.length; g++) {
                const x = pad + g * stepX;
                const y = pad + h * (1 - history[g].top10[rank]);
                if (g === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // 3. 画平均胜率（橙色粗线）
        ctx.strokeStyle = '#ffaa00';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let g = 0; g < history.length; g++) {
            const x = pad + g * stepX;
            const y = pad + h * (1 - history[g].avg);
            if (g === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 4. 画中位数（虚线）
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        for (let g = 0; g < history.length; g++) {
            const x = pad + g * stepX;
            const y = pad + h * (1 - history[g].median);
            if (g === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // X轴标签
        ctx.textAlign = 'center';
        ctx.fillStyle = '#888';
        const labelStep = Math.max(1, Math.floor(history.length / 8));
        for (let g = 0; g < history.length; g += labelStep) {
            const x = pad + g * stepX;
            ctx.fillText(`G${history[g].generation}`, x, H - 15);
        }

        // 标题
        ctx.fillStyle = '#00d2ff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Top 10 + 全部平均 + 中位数', pad, 22);
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
        this.log('新对局开始 - 你执黑', 'info');
    }

    pass() {
        if (this.mode !== 'play') return;
        this.gameBoard.pass();
        this.drawBoard(this.ctxA, this.gameBoard);
        if (!this.gameBoard.isGameOver()) {
            setTimeout(() => this.aiMove(), 300);
        } else {
            this.showGameResult();
        }
    }

    aiMove() {
        if (this.mode !== 'play' || this.gameBoard.isGameOver()) return;
        const difficulty = document.getElementById('difficulty-select').value;
        setTimeout(() => {
            const move = this.trainer.getAIResponse(this.gameBoard, difficulty);
            if (move) {
                this.gameBoard.makeMove(move[0], move[1]);
                this.drawBoard(this.ctxA, this.gameBoard, move);
            } else {
                this.gameBoard.pass();
                this.drawBoard(this.ctxA, this.gameBoard);
            }
            if (this.gameBoard.isGameOver()) this.showGameResult();
        }, 100);
    }

    showGameResult() {
        const winner = this.gameBoard.getWinner();
        const score = this.gameBoard.calculateScore();
        let msg = '';
        if (winner === 0) msg = '平局！';
        else msg = winner === 1
            ? `黑方获胜！(${score.black.toFixed(1)} vs ${score.white.toFixed(1)})`
            : `白方获胜！(${score.white.toFixed(1)} vs ${score.black.toFixed(1)})`;
        this.log(msg, 'success');
        setTimeout(() => alert(msg), 200);
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
            const stats = this.trainer.getStats();
            document.getElementById('generation').textContent = stats.generation;
            document.getElementById('total-games').textContent = stats.totalGames;
            this.updateLeaderboard(stats.top10);
            this.drawChart();
            this.populateAiSelect();
            this.log(`已加载模型 (第${stats.generation}代, ${stats.totalGames}局)`, 'success');
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
                        const stats = this.trainer.getStats();
                        document.getElementById('generation').textContent = stats.generation;
                        document.getElementById('total-games').textContent = stats.totalGames;
                        this.updateLeaderboard(stats.top10);
                        this.drawChart();
                        this.populateAiSelect();
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
        a.download = `eve-go-200-gen-${this.trainer.generation}.json`;
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
                const stats = this.trainer.getStats();
                document.getElementById('generation').textContent = stats.generation;
                document.getElementById('total-games').textContent = stats.totalGames;
                this.updateLeaderboard(stats.top10);
                this.drawChart();
                this.populateAiSelect();
                document.getElementById('upload-status').textContent = '上传成功！';
                this.log('模型上传成功', 'success');
            } catch (err) {
                document.getElementById('upload-status').textContent = '上传失败';
                this.log('上传失败: ' + err.message, 'error');
            }
        };
        reader.readAsText(this.uploadFile);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new GoUI();
});
