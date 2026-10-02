package com.acme.notes

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.acme.notes.databinding.ActivityLoginBinding

/** A classic View screen: layout XML, ViewBinding, and R.id lookups. */
class LoginActivity : AppCompatActivity() {
    private lateinit var binding: ActivityLoginBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.signupButton.setOnClickListener {
            startActivity(Intent(this, HomeActivity::class.java))
        }
        findViewById<android.view.View>(R.id.terms).setOnClickListener { }
    }
}
