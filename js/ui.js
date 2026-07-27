class GoUI {
    constructor() {
        this.boardSize = 19;
        this.canvas = document.getElementById('go-board');
        this.ctx = this.canvas.getContext('2d');
        this.chartCanvas = document.getElementById('chart-canvas');
        this.chartCtx = this.chartCanvas.getContext('2d');

        this.board = new GoBoard(this.boardSize);
        this.trainer = new EveTrainer(this.boardSize);
        this.mode = 'training';
        this.playerColor = 1; // 玩家执黑
        this.gameBoard = new GoBoard(this.boardSize);

        // 19路棋盘绘制参数
        this.cellSize = 30;
        this.offset = 30;
        this.stoneRadius = 13;

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.drawBoard();
        this.loadLatestModel();
        this.drawChart();
        this.log('Eve 已就绪，棋盘大小: 19x19', 'info');
    }

    setupEventListeners() {
        this.canvas.addEventListener('click', (e) => this.handleBoardClick(e));

        document.getElementById('btn-training').addEventListener('click', () => this.switchMode('training'));
        document.getElementById('btn-play').addEventListener('click', () => this.switchMode('play'));

        document.getElementById('btn-start-training').addEventListener('click', () => this.startTraining());
        document.getElementById('btn-stop-training').addEventListener('click', () => this.stopTraining());
        document.getElementById('btn-load-model').addEventListener('click', () => this.loadModel());
        document.getElementById('btn-save-model').addEventListener('click', () => this.saveModel());

        document.getElementById('btn-reset-game').addEventListener('click', () => this.resetGame());
        document.getElementById('btn-pass').addEventListener('click', () => this.pass());
        document.getElementById('btn-ai-move').addEventListener('click', () => this.aiMove());

        document.getElementById('model-upload').addEventListener('change', (e) => this.handleFileUpload(e));
        document.getElementById('btn-upload-model').addEventListener('click', () => this.uploadModel());

        const speedSlider = document.getElementById('speed-slider');
        speedSlider.addEventListener('input', (e) => {
            const speed = parseInt(e.target.value);
            document.getElementById('speed-value').textContent = speed;
            this.trainer.setSpeed(speed);
        });
    }

    switchMode(mode) {
        if (this.trainer.isTraining) {
            this.log('请先停止训练再切换模式', 'warning');
            return;
        }
        this.mode = mode;
        document.getElementById('btn-training').classList.toggle('active', mode === 'training');
        document.getElementById('btn-play').classList.toggle('active', mode === 'play');
        document.getElementById('training-controls').classList.toggle('hidden', mode !== 'training');
        document.getElementById('play-controls').classList.toggle('hidden', mode !== 'play');

        if (mode === 'play') {
            this.resetGame();
        } else {
            this.board.initBoard();
            this.drawBoard();
        }
    }

    handleBoardClick(e) {
        if (this.mode !== 'play') return;
        if (this.gameBoard.currentPlayer !== this.playerColor) return;

        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        const col = Math.round((x - this.offset) / this.cellSize);
        const row = Math.round((y - this.offset) / this.cellSize);

        if (row >= 0 && row < this.boardSize && col >= 0 && col < this.boardSize) {
            if (this.gameBoard.makeMove(row, col)) {
                this.drawBoard(this.gameBoard);
                this.updateGameInfo(this.gameBoard);
                this.drawLastMove(row, col, this.gameBoard.currentPlayer);

                if (!this.gameBoard.isGameOver()) {
                    setTimeout(() => this.aiMove(), 300);
                } else {
                    this.showGameResult();
                }
            }
        }
    }

    drawBoard(board = this.board, lastMove = null) {
        const ctx = this.ctx;
        const size = this.boardSize;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // 棋盘背景渐变
        const bgGrad = ctx.createLinearGradient(0, 0, this.canvas.width, this.canvas.height);
        bgGrad.addColorStop(0, '#dcb35c');
        bgGrad.addColorStop(1, '#c9a040');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // 画线
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
        const starPoints = [[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]];
        for (const [r, c] of starPoints) {
            const x = this.offset + c * this.cellSize;
            const y = this.offset + r * this.cellSize;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#5c4033';
            ctx.fill();
        }

        // 画棋子
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                const stone = board.board[board.idx(row, col)];
                if (stone !== 0) {
                    this.drawStone(row, col, stone);
                }
            }
        }

        // 标记最后一手
        if (lastMove) {
            const x = this.offset + lastMove[1] * this.cellSize;
            const y = this.offset + lastMove[0] * this.cellSize;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#ff0000';
            ctx.fill();
        }
    }

    drawStone(row, col, color) {
        const ctx = this.ctx;
        const x = this.offset + col * this.cellSize;
        const y = this.offset + row * this.cellSize;

        ctx.beginPath();
        ctx.arc(x, y, this.stoneRadius, 0, Math.PI * 2);

        const gradient = ctx.createRadialGradient(x - 4, y - 4, 2, x, y, this.stoneRadius);
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

    drawLastMove(row, col, nextPlayer) {
        const ctx = this.ctx;
        const x = this.offset + col * this.cellSize;
        const y = this.offset + row * this.cellSize;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = nextPlayer === 1 ? '#fff' : '#000';
        ctx.fill();
    }

    async startTraining() {
        document.getElementById('btn-start-training').disabled = true;
        document.getElementById('btn-stop-training').disabled = false;
        document.getElementById('training-status').textContent = '训练中...';
        this.log('开始训练 - 自动加载最新模型参数', 'info');

        // 设置回调
        this.trainer.onMove = (data) => {
            // 实时显示对局
            const tempBoard = new GoBoard(this.boardSize);
            tempBoard.setState(data.board);
            this.drawBoard(tempBoard, data.move);
            this.updateGameInfo(tempBoard);
            document.getElementById('move-count').textContent = data.step;
            document.getElementById('current-game').textContent = `第${data.generation}代 第${data.game}局`;
        };

        this.trainer.onGameEnd = (data) => {
            const winnerText = data.winner === 1 ? '黑胜' : data.winner === 2 ? '白胜' : '平局';
            this.log(`第${data.generation}代第${data.game}局结束 - ${winnerText} (黑${data.score.black} vs 白${data.score.white})`, 'info');
            document.getElementById('games-played').textContent = data.totalGames;
        };

        this.trainer.onGeneration = (data) => {
            document.getElementById('generation').textContent = data.generation;
            const stats = this.trainer.getTrainingStats();
            document.getElementById('win-rate').textContent = `${Math.round(stats.recentWinRate * 100)}%`;
            this.drawChart();
        };

        this.trainer.onLog = (msg, type) => this.log(msg, type);

        await this.trainer.startTraining(3);

        document.getElementById('btn-start-training').disabled = false;
        document.getElementById('btn-stop-training').disabled = true;
        document.getElementById('training-status').textContent = '已停止';
        this.log('训练已停止', 'warning');
    }

    stopTraining() {
        this.trainer.stopTraining();
    }

    resetGame() {
        this.gameBoard.initBoard();
        this.playerColor = 1;
        this.drawBoard(this.gameBoard);
        this.updateGameInfo(this.gameBoard);
        this.log('新对局开始 - 你执黑', 'info');
    }

    pass() {
        if (this.mode !== 'play') return;
        this.gameBoard.pass();
        this.drawBoard(this.gameBoard);
        this.updateGameInfo(this.gameBoard);
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

        // 使用setTimeout避免阻塞UI
        setTimeout(() => {
            const move = this.trainer.getAIResponse(this.gameBoard, difficulty);
            if (move) {
                this.gameBoard.makeMove(move[0], move[1]);
                this.drawBoard(this.gameBoard, move);
                this.updateGameInfo(this.gameBoard);
                this.log(`AI落子: (${move[0]}, ${move[1]})`, 'info');
            } else {
                this.gameBoard.pass();
                this.drawBoard(this.gameBoard);
                this.updateGameInfo(this.gameBoard);
                this.log('AI选择跳过', 'info');
            }

            if (this.gameBoard.isGameOver()) {
                this.showGameResult();
            }
        }, 100);
    }

    updateGameInfo(board) {
        const player = board.currentPlayer === 1 ? '黑方' : '白方';
        document.getElementById('current-player').textContent = player;
        const score = board.calculateScore();
        document.getElementById('black-score').textContent = score.black.toFixed(1);
        document.getElementById('white-score').textContent = score.white.toFixed(1);
        document.getElementById('move-count').textContent = board.moveCount;
    }

    showGameResult() {
        const winner = this.gameBoard.getWinner();
        const score = this.gameBoard.calculateScore();
        let message = '';
        if (winner === 0) message = '平局！';
        else message = winner === 1 ? `黑方获胜！(${score.black} vs ${score.white})` : `白方获胜！(${score.white} vs ${score.black})`;
        this.log(message, 'success');
        setTimeout(() => alert(message), 200);
    }

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
            ctx.fillText('暂无训练数据', W / 2, H / 2);
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

        // 画黑方胜率线
        ctx.strokeStyle = '#00d2ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const stepX = history.length > 1 ? width / (history.length - 1) : 0;
        for (let i = 0; i < history.length; i++) {
            const x = padding + i * stepX;
            const y = padding + height * (1 - history[i].blackWinRate);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 数据点
        ctx.fillStyle = '#00d2ff';
        for (let i = 0; i < history.length; i++) {
            const x = padding + i * stepX;
            const y = padding + height * (1 - history[i].blackWinRate);
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // X轴标签
        ctx.textAlign = 'center';
        const labelStep = Math.max(1, Math.floor(history.length / 10));
        for (let i = 0; i < history.length; i += labelStep) {
            const x = padding + i * stepX;
            ctx.fillText(`G${history[i].generation}`, x, H - 15);
        }

        // 标题
        ctx.fillStyle = '#00d2ff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('黑方胜率趋势', padding, 25);
    }

    log(message, type = 'info') {
        const logContent = document.getElementById('log-content');
        const p = document.createElement('p');
        p.className = type;
        const time = new Date().toLocaleTimeString();
        p.textContent = `[${time}] ${message}`;
        logContent.appendChild(p);
        logContent.scrollTop = logContent.scrollHeight;

        // 限制日志条数
        while (logContent.children.length > 100) {
            logContent.removeChild(logContent.firstChild);
        }
    }

    async loadLatestModel() {
        const loaded = await this.trainer.loadLatestModel();
        if (loaded) {
            const stats = this.trainer.getTrainingStats();
            document.getElementById('generation').textContent = stats.generation;
            document.getElementById('games-played').textContent = stats.gamesPlayed;
            document.getElementById('win-rate').textContent = `${Math.round(stats.recentWinRate * 100)}%`;
            this.drawChart();
            this.log(`已加载最新模型 (第${stats.generation}代, ${stats.gamesPlayed}局)`, 'success');
        } else {
            this.log('未找到已保存的模型，将从零开始训练', 'info');
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
                        document.getElementById('games-played').textContent = stats.gamesPlayed;
                        document.getElementById('win-rate').textContent = `${Math.round(stats.recentWinRate * 100)}%`;
                        this.drawChart();
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
                document.getElementById('games-played').textContent = stats.gamesPlayed;
                document.getElementById('win-rate').textContent = `${Math.round(stats.recentWinRate * 100)}%`;
                this.drawChart();
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