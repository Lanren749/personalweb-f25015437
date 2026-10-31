'use strict';

const express = require('express');
const { requireAuth, requireAdmin } = require('../auth');
const defaultStore = require('../intelligence/store');
const { createSchedulerService } = require('../intelligence/schedule');

function safeError(error) {
  // Do not return mysql connection details, API URLs or provider keys.
  console.error('[intelligence API] request failed');
  return { error: '服务器内部错误' };
}

function publicJob(job) {
  return job ? { ...job, error: job.error ? '本次更新未完成，旧快照已保留，请稍后重试' : null } : null;
}

function createIntelligenceRouter(options = {}) {
  const store = options.store || defaultStore;
  const service = options.service || createSchedulerService({
    store,
    pipeline: options.pipeline
  });
  const router = express.Router();
  router.use(requireAuth);

  router.get('/dashboard', async (req, res) => {
    try {
      const snapshot = await store.latestSnapshot();
      res.json({
        snapshot,
        history: await store.history(),
        job: publicJob(await store.getJob()),
        settings: await service.scheduleInfo(),
        reviews: snapshot ? await store.reviews(snapshot.id) : {},
        directionActions: store.directionActions ? await store.directionActions(req.user.id) : {},
        user: req.user
      });
    } catch (error) { res.status(500).json(safeError(error)); }
  });

  router.get('/settings', async (req, res) => {
    try {
      return res.json({ settings: await service.scheduleInfo() });
    } catch (error) { return res.status(500).json(safeError(error)); }
  });

  router.put('/settings', requireAdmin, async (req, res) => {
    try {
      return res.json({ settings: await service.updateSettings(req.body) });
    } catch (error) {
      if (error && error.code === 'INVALID_INTELLIGENCE_SETTINGS') return res.status(400).json({ error: error.message });
      return res.status(500).json(safeError(error));
    }
  });

  router.get('/history', async (req, res) => {
    try {
      res.json({ history: await store.history(), jobs: store.jobHistory ? (await store.jobHistory()).map(publicJob) : [] });
    } catch (error) { res.status(500).json(safeError(error)); }
  });

  router.get('/history/:id', async (req, res) => {
    try {
      const snapshot = await store.getSnapshot(req.params.id);
      if (!snapshot) return res.status(404).json({ error: '该期情报不存在' });
      return res.json({ snapshot, reviews: await store.reviews(snapshot.id) });
    } catch (error) { return res.status(500).json(safeError(error)); }
  });

  router.post('/refresh', requireAdmin, async (req, res) => {
    try {
      const started = await service.beginRefresh({ reason: 'manual', userId: req.user.id });
      if (started.promise) started.promise.catch(() => {});
      if (!started.acquired) return res.status(started.rateLimited ? 429 : 409).json({
        error: started.rateLimited ? '更新失败后的等待期尚未结束，请稍后重试' : '更新任务正在运行',
        job: publicJob(await store.getJob())
      });
      // beginRefresh resolves only after the running row is written, so the
      // 202 response cannot race with the initial status update.
      return res.status(202).json({ job: publicJob(started.job) });
    } catch (error) { return res.status(500).json(safeError(error)); }
  });

  router.put('/reviews/:companyId', async (req, res) => {
    try {
      const statusList = ['继续研究', '暂缓', '排除', '未复核'];
      const body = req.body || {};
      const snapshotId = body.snapshotId == null ? '' : String(body.snapshotId).trim();
      if (!snapshotId) return res.status(400).json({ error: '必须提供 snapshotId' });
      if (!statusList.includes(body.status)) return res.status(400).json({ error: '无效的复核状态' });
      if (body.synergyLevel !== undefined && !['高', '中', '待核实'].includes(body.synergyLevel)) {
        return res.status(400).json({ error: '无效的协同等级' });
      }
      const snapshot = await store.getSnapshot(snapshotId);
      if (!snapshot) return res.status(404).json({ error: '该期情报不存在' });
      const company = (snapshot.companies || []).find(item => String(item.id) === String(req.params.companyId));
      if (!company) return res.status(404).json({ error: '该企业不在指定快照中' });
      const review = await store.saveReview({
        snapshotId,
        companyId: company.id,
        status: body.status,
        synergyLevel: body.synergyLevel,
        note: String(body.note || '').slice(0, 1000),
        userId: req.user.id,
        reviewerName: req.user.displayName || req.user.username || null
      });
      return res.json({ review });
    } catch (error) { return res.status(500).json(safeError(error)); }
  });

  router.put('/direction-actions/:directionId', async (req, res) => {
    try {
      const body = req.body || {};
      const directionId = String(req.params.directionId || '').trim();
      const snapshotId = String(body.snapshotId || '').trim();
      if (!directionId || directionId.length > 120 || !snapshotId) return res.status(400).json({ error: '方向或快照参数无效' });
      if (typeof body.focused !== 'boolean') return res.status(400).json({ error: '人工关注状态无效' });
      const snapshot = await store.getSnapshot(snapshotId);
      if (!snapshot) return res.status(404).json({ error: '该期情报不存在' });
      const direction = (snapshot.directions || []).find(item => String(item.id) === directionId);
      if (!direction) return res.status(404).json({ error: '该方向不在指定快照中' });
      if (!store.saveDirectionAction) return res.status(503).json({ error: '当前服务不支持保存方向关注' });
      const action = await store.saveDirectionAction({
        userId: req.user.id, directionId, directionName: direction.name,
        focused: body.focused, note: String(body.note || '').trim().slice(0, 500)
      });
      return res.json({ action });
    } catch (error) { return res.status(500).json(safeError(error)); }
  });

  return { router, service };
}

const defaults = createIntelligenceRouter();
module.exports = {
  router: defaults.router,
  service: defaults.service,
  createIntelligenceRouter,
  runRefresh: defaults.service.runRefresh,
  beginRefresh: defaults.service.beginRefresh,
  startScheduler: defaults.service.startScheduler,
  stopScheduler: defaults.service.stopScheduler,
  scheduleInfo: defaults.service.scheduleInfo,
  updateSettings: defaults.service.updateSettings
};
