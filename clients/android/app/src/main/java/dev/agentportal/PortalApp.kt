package dev.agentportal

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.room.Room
import kotlinx.coroutines.*

class PortalApp : Application(), DefaultLifecycleObserver {
    lateinit var repo: Repository
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onCreate() {
        super<Application>.onCreate()
        repo =
            Repository(
                this,
                Room.databaseBuilder(this, PortalDb::class.java, "portal.db")
                    .addMigrations(PortalDb.MIGRATION_1_2)
                    .build(),
            )
        ProcessLifecycleOwner.get().lifecycle.addObserver(this)
    }

    override fun onStart(owner: LifecycleOwner) {
        repo.foreground = true
        repo.start()
    }

    override fun onStop(owner: LifecycleOwner) {
        repo.foreground = false
        repo.stop()
    }
}
