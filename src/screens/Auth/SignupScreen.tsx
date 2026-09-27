import React, { useState, useContext } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  Image, 
  SafeAreaView,
  TouchableWithoutFeedback,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

// Context
import { ThemeContext } from '../../contexts/ThemeContext';
import { AuthContext } from '../../contexts/AuthContext';

// Types
import { AuthStackParamList } from '../../navigation/AuthNavigator';

// Services
import { authService } from '../../services/authService';

type SignupScreenNavigationProp = StackNavigationProp<AuthStackParamList, 'Signup'>;

const SignupScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<SignupScreenNavigationProp>();
  const { theme } = useContext(ThemeContext);
  const { signIn } = useContext(AuthContext);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);

  const togglePasswordVisibility = () => {
    setIsPasswordVisible(!isPasswordVisible);
  };

  const toggleConfirmPasswordVisibility = () => {
    setIsConfirmPasswordVisible(!isConfirmPasswordVisible);
  };

  const validateInputs = () => {
    if (!firstName.trim()) {
      setSignupError('First name is required');
      return false;
    }
    
    if (!lastName.trim()) {
      setSignupError('Last name is required');
      return false;
    }
    
    if (!email.trim()) {
      setSignupError('Email is required');
      return false;
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setSignupError('Please enter a valid email address');
      return false;
    }
    
    if (!password) {
      setSignupError('Password is required');
      return false;
    }
    
    if (password.length < 8) {
      setSignupError('Password must be at least 8 characters long');
      return false;
    }
    
    // Enhanced password validation
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    
    if (!hasUpperCase || !hasLowerCase || !hasNumbers || !hasSpecialChar) {
      setSignupError('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character');
      return false;
    }
    
    if (password !== confirmPassword) {
      setSignupError('Passwords do not match');
      return false;
    }
    
    return true;
  };

  const handleSignup = async () => {
    // Validate inputs
    if (!validateInputs()) {
      return;
    }

    try {
      setIsLoading(true);
      setSignupError(null);
      
      // Register the user
      const response = await authService.registerUser({
        email,
        password,
        firstName,
        lastName
      });
      
      console.log('Registration successful:', {
        userId: response.user?.id,
        email: response.user?.email,
        hasAccessToken: !!response.accessToken,
        hasToken: !!response.token
      });
      
      // Check if we have a token in either location
      const token = response.accessToken || response.token;
      
      if (!token) {
        setSignupError('Registration successful but no authentication token received');
        console.error('No token in registration response; keys:', Object.keys(response || {}));
        return;
      }
      
      // Show success message
      Alert.alert(
        'Registration Successful',
        'Your account has been created successfully!',
        [
          { 
            text: 'Sign In', 
            onPress: () => {
              // Auto login after successful registration
              signIn(token, response);
            } 
          }
        ]
      );
    } catch (error) {
      console.error('Registration error:', error);
      
      // Extract the specific error message
      let errorMessage = 'Registration failed';
      
      if (error instanceof Error) {
        // Try to extract the most useful part of the error message
        const message = error.message;
        
        if (message.includes('Password:')) {
          // Extract just the password requirements if available
          const passwordError = message.split('Password:')[1]?.trim();
          if (passwordError) {
            errorMessage = `Password error: ${passwordError}`;
          } else {
            errorMessage = 'Password does not meet requirements';
          }
        } else if (message.includes('Email:')) {
          // Extract just the email error if available
          const emailError = message.split('Email:')[1]?.split(';')[0]?.trim();
          if (emailError) {
            errorMessage = `Email error: ${emailError}`;
          } else {
            errorMessage = 'Invalid email address';
          }
        } else {
          // Use the full error message if it's not too long
          errorMessage = message.length > 100 ? message.substring(0, 100) + '...' : message;
        }
      }
      
      setSignupError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const styles = makeStyles(theme);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollViewContent}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.inner}>
              <View style={styles.logoContainer}>
                <Image 
                  source={require('../../../assets/images/logo.png')} 
                  style={styles.logo}
                  resizeMode="contain"
                />
                <Text style={styles.appName}>{t('app.name')}</Text>
              </View>

              <View style={styles.formContainer}>
                <Text style={styles.welcomeText}>{t('auth.createAccount')}</Text>
                
                {signupError ? (
                  <View style={styles.errorContainer}>
                    <Ionicons name="alert-circle-outline" size={20} color="#FF6B6B" />
                    <Text style={styles.errorText}>{signupError}</Text>
                  </View>
                ) : null}
                
                <View style={styles.nameRow}>
                  <View style={[styles.inputContainer, styles.halfInput]}>
                    <Ionicons name="person-outline" size={20} color={theme.text} style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder={t('auth.firstName')}
                      placeholderTextColor={theme.text + '80'}
                      autoCapitalize="words"
                      value={firstName}
                      onChangeText={setFirstName}
                    />
                  </View>
                  
                  <View style={[styles.inputContainer, styles.halfInput]}>
                    <TextInput
                      style={styles.input}
                      placeholder={t('auth.lastName')}
                      placeholderTextColor={theme.text + '80'}
                      autoCapitalize="words"
                      value={lastName}
                      onChangeText={setLastName}
                    />
                  </View>
                </View>
                
                <View style={styles.inputContainer}>
                  <Ionicons name="mail-outline" size={20} color={theme.text} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder={t('auth.email')}
                    placeholderTextColor={theme.text + '80'}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={email}
                    onChangeText={setEmail}
                  />
                </View>
                
                <View style={styles.inputContainer}>
                  <Ionicons name="lock-closed-outline" size={20} color={theme.text} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder={t('auth.password')}
                    placeholderTextColor={theme.text + '80'}
                    secureTextEntry={!isPasswordVisible}
                    value={password}
                    onChangeText={setPassword}
                  />
                  <TouchableOpacity onPress={togglePasswordVisibility} style={styles.visibilityIcon}>
                    <Ionicons 
                      name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'} 
                      size={20} 
                      color={theme.text}
                    />
                  </TouchableOpacity>
                </View>
                
                <Text style={styles.passwordHint}>
                  Password must be at least 8 characters with uppercase, lowercase, number, and special character.
                </Text>
                
                <View style={styles.inputContainer}>
                  <Ionicons name="lock-closed-outline" size={20} color={theme.text} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder={t('auth.confirmPassword')}
                    placeholderTextColor={theme.text + '80'}
                    secureTextEntry={!isConfirmPasswordVisible}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                  />
                  <TouchableOpacity onPress={toggleConfirmPasswordVisibility} style={styles.visibilityIcon}>
                    <Ionicons 
                      name={isConfirmPasswordVisible ? 'eye-off-outline' : 'eye-outline'} 
                      size={20} 
                      color={theme.text}
                    />
                  </TouchableOpacity>
                </View>
                
                <TouchableOpacity
                  style={styles.signupButton}
                  onPress={handleSignup}
                  disabled={isLoading}
                >
                  <Text style={styles.signupButtonText}>{t('auth.signUp')}</Text>
                </TouchableOpacity>
                
                <View style={styles.loginContainer}>
                  <Text style={styles.loginText}>{t('auth.alreadyHaveAccount')} </Text>
                  <TouchableOpacity onPress={() => navigation.navigate('Login')}>
                    <Text style={styles.loginLink}>{t('auth.signIn')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const makeStyles = (theme: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollViewContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  logo: {
    width: 80,
    height: 80,
  },
  appName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: theme.primary,
    marginTop: 10,
  },
  formContainer: {
    width: '100%',
    maxWidth: 400,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: theme.text,
    marginBottom: 25,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderRadius: 10,
    marginBottom: 15,
    padding: 15,
    borderWidth: 1,
    borderColor: '#FF6B6B',
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 14,
    marginLeft: 10,
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  halfInput: {
    width: '48%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderRadius: 10,
    marginBottom: 15,
    height: 55,
    borderWidth: 1,
    borderColor: theme.border,
  },
  inputIcon: {
    marginLeft: 15,
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: '100%',
    color: theme.text,
    fontSize: 16,
  },
  visibilityIcon: {
    padding: 10,
  },
  signupButton: {
    backgroundColor: theme.primary,
    borderRadius: 10,
    height: 55,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  signupButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
  loginText: {
    color: theme.text,
    fontSize: 14,
  },
  loginLink: {
    color: theme.primary,
    fontSize: 14,
    fontWeight: 'bold',
  },
  passwordHint: {
    fontSize: 12,
    color: theme.text + 'AA',
    marginTop: -10,
    marginBottom: 15,
    marginLeft: 5,
  },
});

export default SignupScreen; 