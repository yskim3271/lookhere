package com.acme.notes

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.acme.notes.databinding.ActivityLoginBinding

class LoginActivity : AppCompatActivity() {
    private lateinit var binding: ActivityLoginBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.signupButton.setOnClickListener { startSignup() }
        findViewById<android.view.View>(R.id.terms).setOnClickListener { openTerms() }
    }

    private fun startSignup() {}
    private fun openTerms() {}
}
