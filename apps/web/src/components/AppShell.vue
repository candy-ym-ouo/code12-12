<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import { ArrowDown } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import { useSpeciesStore } from "@/stores/species";
import { useTaskStore } from "@/stores/task";

const auth = useAuthStore();
const siteStore = useSiteStore();
const speciesStore = useSpeciesStore();
const taskStore = useTaskStore();
const route = useRoute();
const router = useRouter();

const activeNav = computed(() => {
  const name = String(route.name ?? "");
  if (name.startsWith("observation")) return "timeline";
  return name;
});

onMounted(async () => {
  await Promise.all([siteStore.fetch(), speciesStore.fetch(), taskStore.fetch("ACTIVE")]);
});

async function handleLogout() {
  await ElMessageBox.confirm("确定退出登录吗？", "退出登录", { type: "warning" });
  await auth.logout();
  await router.push({ name: "login" });
}
</script>

<template>
  <div class="shell">
    <header class="shell-header">
      <div class="shell-header__inner">
        <router-link to="/" class="brand" aria-label="自然观察时间线首页">
          <span class="brand__mark" aria-hidden="true"></span>
          <span class="brand__text">自然观察时间线</span>
        </router-link>

        <nav class="shell-nav" aria-label="主导航">
          <router-link class="shell-nav__item" :class="{ 'is-active': activeNav === 'timeline' }" to="/">
            时间线
          </router-link>
          <router-link class="shell-nav__item" :class="{ 'is-active': activeNav === 'compare' }" to="/compare">
            跨年对比
          </router-link>
          <router-link class="shell-nav__item" :class="{ 'is-active': activeNav === 'stats' }" to="/stats">
            统计
          </router-link>
          <router-link class="shell-nav__item" :class="{ 'is-active': activeNav === 'sites' }" to="/sites">
            地点
          </router-link>
          <router-link class="shell-nav__item shell-nav__item--badge" :class="{ 'is-active': activeNav === 'tasks' }" to="/tasks">
            任务
            <span v-if="taskStore.overdueCount > 0" class="nav-badge" aria-label="逾期待办数">{{ taskStore.overdueCount }}</span>
          </router-link>
          <router-link class="shell-nav__item" :class="{ 'is-active': activeNav === 'species' }" to="/species">
            物种
          </router-link>
        </nav>

        <div class="spacer"></div>

        <el-dropdown trigger="click">
          <el-button text aria-label="账号菜单">
            {{ auth.displayName || "账号" }}
            <el-icon><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="router.push('/settings')">设置与导出</el-dropdown-item>
              <el-dropdown-item divided @click="handleLogout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <main>
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100%;
}

.shell-header {
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(255, 255, 255, 0.96);
  border-bottom: 1px solid var(--color-border);
  backdrop-filter: blur(6px);
}

.shell-header__inner {
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 16px;
  height: 56px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text);
  font-weight: 600;
  white-space: nowrap;
}

.brand__mark {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--color-primary);
  box-shadow: 0 0 0 4px var(--color-primary-soft);
}

.shell-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.shell-nav__item {
  display: inline-flex;
  align-items: center;
  height: 36px;
  padding: 0 12px;
  border-radius: 6px;
  color: var(--color-text-muted);
  font-size: 14px;
}

.shell-nav__item:hover {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

.shell-nav__item.is-active {
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: 600;
}

.shell-nav__item--badge {
  position: relative;
}

.nav-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  margin-left: 4px;
  border-radius: 9px;
  background: #b3261e;
  color: #fff;
  font-size: 11px;
  line-height: 1;
}

@media (max-width: 767px) {
  .shell-header__inner {
    gap: 8px;
    padding: 0 12px;
  }
  .brand__text {
    display: none;
  }
  .shell-nav {
    overflow-x: auto;
    scrollbar-width: none;
  }
  .shell-nav::-webkit-scrollbar {
    display: none;
  }
  .shell-nav__item {
    padding: 0 10px;
    white-space: nowrap;
  }
}
</style>
